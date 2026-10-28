import { sql } from "@/lib/neon";
import { generateToken, hashToken, verifyPassword } from "@/lib/auth/password.server";

/**
 * Sovereign account merge.
 *
 * A — the primary (kept) account mints a 5-minute pin + QR token.
 * B — the second account enters the pin and gets a preview of both accounts;
 *     a 6-digit code is e-mailed to that account's address.
 * C — with the code it chooses which handle and which card design to keep.
 *     Everything (links, sign-ins, passkeys, badges, data) moves to the primary
 *     account without duplicates; the other design becomes a saved template.
 */

const TICKET_TTL_MINUTES = 5;
type Row = Record<string, unknown>;
export type MergeSide = "primary" | "secondary";

export type MergeAccountSummary = {
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  verified: boolean;
  email: string | null;
  providers: string[];
};

function randomPin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(n % 1_000_000).padStart(6, "0");
}

export async function createMergeTicket(primaryUserId: string) {
  const pin = randomPin();
  const token = generateToken(24);
  const [pinHash, tokenHash] = await Promise.all([hashToken(pin), hashToken(token)]);
  await sql`update public.account_merge_tickets set used_at = now()
     where primary_user_id = ${primaryUserId} and used_at is null`;
  const rows = (await sql`
    insert into public.account_merge_tickets (primary_user_id, pin_hash, token_hash, expires_at)
    values (${primaryUserId}, ${pinHash}, ${tokenHash}, now() + make_interval(mins => ${TICKET_TTL_MINUTES}))
    returning id, expires_at`) as Row[];
  const expiresAt = String(rows[0]?.["expires_at"]);
  try {
    const { notifyUser } = await import("./notifications.server");
    await notifyUser(primaryUserId, "merge_verification", { ticket_id: rows[0]?.["id"], expires_at: expiresAt },
      { EXPIRES_AT: expiresAt, TTL_MINUTES: TICKET_TTL_MINUTES });
  } catch (error) {
    console.error("[merge] notify failed", error);
  }
  return { pin, token, ticketId: rows[0]?.["id"] as string, expiresAt };
}

async function countMergeFailures(userId: string): Promise<number> {
  try {
    const { sha256Hex } = await import("./rate-limit-db.server");
    const bucket = `merge-redeem-fail:${await sha256Hex(userId)}`;
    const rows = (await sql`select coalesce(sum(hits), 0)::int as hits from public.rate_limits
       where bucket = ${bucket} and window_start > now() - make_interval(mins => ${TICKET_TTL_MINUTES * 2})`) as Row[];
    return Number(rows[0]?.["hits"] ?? 0);
  } catch {
    return 0;
  }
}

async function findTicket(pin: string | null, token: string | null) {
  const hash = await hashToken((pin ?? token ?? "").trim());
  const rows = (await sql`select id, primary_user_id, preview_user_id, expires_at from public.account_merge_tickets
     where used_at is null and expires_at > now() and (pin_hash = ${hash} or token_hash = ${hash})
     order by created_at desc limit 1`) as Row[];
  return rows[0] ?? null;
}

async function resolveTicket(secondaryUserId: string, pin: string | null, token: string | null) {
  const { hitRateLimit } = await import("./rate-limit-db.server");
  if ((await countMergeFailures(secondaryUserId)) >= 5) return { error: "invalid_or_expired" as const };
  const ticket = await findTicket(pin, token);
  if (!ticket) {
    await hitRateLimit("merge-redeem-fail", secondaryUserId, { limit: 5, windowSec: TICKET_TTL_MINUTES * 60 });
    return { error: "invalid_or_expired" as const };
  }
  if (ticket["primary_user_id"] === secondaryUserId) return { error: "same_account" as const };
  return { ticket };
}

async function summary(userId: string): Promise<MergeAccountSummary> {
  const rows = (await sql`select p.username, p.display_name, p.avatar_url, p.verified, u.email
    from public.users u left join public.profiles p on p.id = u.id where u.id = ${userId} limit 1`) as Row[];
  const r = rows[0] ?? {};
  let providers: string[] = [];
  try {
    const { linkedAccountsOf } = await import("@/lib/oauth/provider.server");
    providers = [...new Set((await linkedAccountsOf(userId)).map((a) => a.provider))];
  } catch {
    /* summary stays usable without providers */
  }
  const { maskEmail } = await import("./security-code.server");
  return {
    handle: (r["username"] as string | null) ?? null,
    displayName: (r["display_name"] as string | null) ?? null,
    avatarUrl: (r["avatar_url"] as string | null) ?? null,
    verified: Boolean(r["verified"]),
    email: r["email"] ? maskEmail(String(r["email"])) : null,
    providers,
  };
}

/** Step B: validate the pin, show both accounts and e-mail a confirmation code. */
export async function previewMerge(input: { secondaryUserId: string; pin?: string | null; token?: string | null; request?: Request | null }) {
  const found = await resolveTicket(input.secondaryUserId, input.pin ?? null, input.token ?? null);
  if ("error" in found) return { ok: false as const, reason: found.error };
  const ticket = found.ticket!;
  await sql`update public.account_merge_tickets set preview_user_id = ${input.secondaryUserId}
    where id = ${ticket["id"] as string}`;
  const { issueSecurityCode } = await import("./security-code.server");
  const sent = await issueSecurityCode(input.secondaryUserId, "merge", input.request);
  if (!sent.ok) return { ok: false as const, reason: sent.reason };
  const [primary, secondary] = await Promise.all([summary(ticket["primary_user_id"] as string), summary(input.secondaryUserId)]);
  return { ok: true as const, primary, secondary, codeSentTo: sent.sentTo };
}

// ---------------------------------------------------------------------------
// Data transfer
// ---------------------------------------------------------------------------

/** Short-lived or per-login rows that are simply dropped for the old account. */
const DROP_TABLES = new Set([
  "user_sessions", "security_codes", "oauth_auth_codes", "oauth_step_up_codes", "phone_otp_codes", "auth_tokens", "profile_drafts",
]);

const ident = (name: string) => `"${name.replace(/"/g, "")}"`;

/** Move rows one by one; a row that would duplicate something the primary already has is dropped. */
async function moveRows(table: string, column: string, primaryId: string, secondaryId: string) {
  const t = `public.${ident(table)}`;
  const c = ident(column);
  try {
    await sql.query(`update ${t} set ${c} = $1 where ${c} = $2`, [primaryId, secondaryId]);
    return;
  } catch {
    /* conflict somewhere → row by row */
  }
  const rows = (await sql.query(`select ctid::text as k from ${t} where ${c} = $1`, [secondaryId])) as Row[];
  for (const row of rows) {
    try {
      await sql.query(`update ${t} set ${c} = $1 where ctid = $2::tid`, [primaryId, row["k"]]);
    } catch {
      await sql.query(`delete from ${t} where ctid = $1::tid`, [row["k"]]).catch((e: unknown) =>
        console.error(`[merge] could not move ${table}`, e));
    }
  }
}

async function transferOwnership(primaryId: string, secondaryId: string) {
  const cols = (await sql`select table_name, column_name from information_schema.columns
    where table_schema = 'public' and column_name in ('user_id', 'profile_id')
      and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')`) as Row[];
  for (const r of cols) {
    const table = String(r["table_name"]);
    const column = String(r["column_name"]);
    if (DROP_TABLES.has(table)) {
      await sql.query(`delete from public.${ident(table)} where ${ident(column)} = $1`, [secondaryId]).catch(() => {});
      continue;
    }
    // Same social link on both profiles → keep one.
    if (table === "social_links") {
      await sql`delete from public.social_links s where s.profile_id = ${secondaryId} and exists (
        select 1 from public.social_links p where p.profile_id = ${primaryId}
          and p.platform = s.platform and lower(p.username) = lower(s.username))`.catch(() => {});
    }
    await moveRows(table, column, primaryId, secondaryId);
  }

  // Better Auth sign-ins (Google, Apple, passkeys…) live under the Better Auth user id.
  const ids = (await sql`select id, email, user_metadata->>'neon_auth_id' as ba from public.users
    where id in (${primaryId}, ${secondaryId})`) as Row[];
  const prim = ids.find((r) => r["id"] === primaryId);
  const sec = ids.find((r) => r["id"] === secondaryId);
  const pBa = (prim?.["ba"] as string | null) ?? null;
  const sBa = (sec?.["ba"] as string | null) ?? null;
  if (sBa && pBa && sBa !== pBa) {
    await sql`delete from neon_auth.account s where s."userId"::text = ${sBa} and exists (
      select 1 from neon_auth.account p where p."userId"::text = ${pBa} and p."providerId" = s."providerId"
        and (p."accountId" = s."accountId" or s."providerId" = 'credential'))`;
    await sql`update neon_auth.account set "userId" = ${pBa}::uuid, "updatedAt" = now() where "userId"::text = ${sBa}`;
    await sql`update neon_auth.passkey set "userId" = ${pBa}::uuid where "userId"::text = ${sBa}`.catch((e: unknown) =>
      console.error("[merge] passkeys", e));
    await sql.query(`delete from neon_auth."twoFactor" where "userId"::text = $1`, [sBa]).catch(() => {});
    await sql`delete from neon_auth.session where "userId"::text = ${sBa}`.catch(() => {});
    await sql`delete from neon_auth."user" where id::text = ${sBa}`.catch((e: unknown) => console.error("[merge] ba user", e));
  } else if (sBa && !pBa) {
    // Primary had no Better Auth login yet: adopt the other one under the primary's e-mail.
    await sql`delete from neon_auth.session where "userId"::text = ${sBa}`.catch(() => {});
    await sql`update neon_auth."user" set email = ${String(prim?.["email"] ?? "")}, "updatedAt" = now() where id::text = ${sBa}`;
    await sql`update public.users set user_metadata = coalesce(user_metadata, '{}'::jsonb) || ${JSON.stringify({ neon_auth_id: sBa })}::jsonb
      where id = ${primaryId}`;
  }

  // Verification, tier and paid status always win in favour of "yes".
  await sql`update public.profiles p
       set verified = p.verified or s.verified,
           verified_at = coalesce(p.verified_at, s.verified_at),
           verified_legal_name = coalesce(p.verified_legal_name, s.verified_legal_name),
           tier = case when s.tier = 'verified' or p.tier = 'verified' then 'verified' else p.tier end,
           is_paid = p.is_paid or s.is_paid,
           is_early_believer = p.is_early_believer or s.is_early_believer,
           is_business = coalesce(p.is_business, false) or coalesce(s.is_business, false),
           is_influencer = coalesce(p.is_influencer, false) or coalesce(s.is_influencer, false),
           updated_at = now()
      from public.profiles s
     where p.id = ${primaryId} and s.id = ${secondaryId}`;
}

/** Step C: code + choices → merge. */
export async function redeemMergeTicket(input: {
  secondaryUserId: string;
  pin?: string | null;
  token?: string | null;
  code: string;
  keepHandle: MergeSide;
  keepDesign: MergeSide;
}) {
  const found = await resolveTicket(input.secondaryUserId, input.pin ?? null, input.token ?? null);
  if ("error" in found) return { ok: false as const, reason: found.error };
  const ticket = found.ticket!;
  if (ticket["preview_user_id"] !== input.secondaryUserId) return { ok: false as const, reason: "invalid_or_expired" as const };
  const { consumeSecurityCode } = await import("./security-code.server");
  if (!(await consumeSecurityCode(input.secondaryUserId, "merge", input.code))) {
    return { ok: false as const, reason: "bad_code" as const };
  }
  // Claim the ticket first so a double click cannot run the merge twice.
  const claimed = (await sql`update public.account_merge_tickets set used_at = now(), secondary_user_id = ${input.secondaryUserId}
    where id = ${ticket["id"] as string} and used_at is null returning id`) as Row[];
  if (!claimed.length) return { ok: false as const, reason: "invalid_or_expired" as const };

  const primaryId = ticket["primary_user_id"] as string;
  const secondaryId = input.secondaryUserId;
  const design = await import("./design-templates.server");
  const [pSnap, sSnap] = await Promise.all([design.snapshotDesign(primaryId), design.snapshotDesign(secondaryId)]);
  const handles = (await sql`select id, username from public.profiles where id in (${primaryId}, ${secondaryId})`) as Row[];
  const pHandle = (handles.find((h) => h["id"] === primaryId)?.["username"] as string | null) ?? null;
  const sHandle = (handles.find((h) => h["id"] === secondaryId)?.["username"] as string | null) ?? null;

  await transferOwnership(primaryId, secondaryId);

  // The design that is not chosen is kept as a saved template.
  if (input.keepDesign === "secondary" && sSnap) {
    if (pSnap) await design.saveTemplate(primaryId, `Ontwerp van @${pHandle ?? "hoofdaccount"}`, pSnap);
    await design.writeDesign(primaryId, sSnap);
    await design.saveTemplate(primaryId, `Ontwerp van @${sHandle ?? "tweede account"}`, sSnap);
  } else if (sSnap) {
    await design.saveTemplate(primaryId, `Ontwerp van @${sHandle ?? "tweede account"}`, sSnap);
  }

  await sql`delete from public.profiles where id = ${secondaryId}`;
  await sql`delete from public.users where id = ${secondaryId}`;

  if (input.keepHandle === "secondary" && sHandle) {
    await sql`update public.profiles set username = ${sHandle}, updated_at = now() where id = ${primaryId}`.catch((e: unknown) =>
      console.error("[merge] handle swap", e));
  }
  return { ok: true as const, primaryUserId: primaryId };
}

export async function verifyOwnPassword(userId: string, password: string) {
  const rows = (await sql`select password_hash from public.users where id = ${userId} limit 1`) as Row[];
  return verifyPassword(password, (rows[0]?.["password_hash"] as string | null) ?? null);
}
