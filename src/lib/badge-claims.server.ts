/** Claim-a-Stamp: claim links that grant a custom badge. Admin checks happen in the callers. */
import { sql } from "@/lib/neon";
import { writeAudit } from "./admin.server";
import { runSchemaEnsure } from "@/lib/db/schema-ensure.server";
import { claimState } from "./stamp-rules";

/** Safety net for db/92 when migrations have not run yet. */
let ready: Promise<void> | null = null;
function ensureTables() {
  ready ??= runSchemaEnsure(async () => {
    await sql`create table if not exists public.badge_claim_links (
      id uuid primary key default gen_random_uuid(), token text not null unique,
      badge_id uuid not null references public.custom_badges(id) on delete cascade, reason text,
      max_claims integer, claims_count integer not null default 0, expires_at timestamptz, revoked_at timestamptz,
      created_by uuid, created_at timestamptz not null default now())`;
    await sql`create table if not exists public.badge_claim_redemptions (
      link_id uuid not null references public.badge_claim_links(id) on delete cascade, user_id uuid not null,
      claimed_at timestamptz not null default now(), primary key (link_id, user_id))`;
  }, "badge_claim_links").catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "stamp_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createClaimLink(adminId: string, input: { badgeId: string; maxClaims: number | null; expiresAt: string | null; reason: string | null }) {
  await ensureTables();
  const token = newToken();
  const rows = (await sql`insert into public.badge_claim_links (token, badge_id, reason, max_claims, expires_at, created_by)
    values (${token}, ${input.badgeId}, ${input.reason}, ${input.maxClaims}, ${input.expiresAt}, ${adminId}) returning id`) as Row[];
  await writeAudit({ adminId, action: "badge_claim_link_create", targetLabel: `${input.badgeId} (${token})` });
  return { ok: true as const, id: String(rows[0]?.["id"]), token };
}

export async function listClaimLinks(badgeId: string) {
  await ensureTables();
  const rows = (await sql`select id, token, reason, max_claims, claims_count, expires_at, revoked_at, created_at
    from public.badge_claim_links where badge_id = ${badgeId} order by created_at desc limit 100`) as Row[];
  return rows.map((r) => ({
    id: String(r["id"]),
    token: String(r["token"]),
    reason: (r["reason"] as string | null) ?? null,
    maxClaims: r["max_claims"] == null ? null : Number(r["max_claims"]),
    claims: Number(r["claims_count"] ?? 0),
    expiresAt: iso(r["expires_at"]),
    revoked: r["revoked_at"] != null,
    createdAt: iso(r["created_at"]),
  }));
}

export async function revokeClaimLink(adminId: string, id: string) {
  await sql`update public.badge_claim_links set revoked_at = now() where id = ${id} and revoked_at is null`;
  await writeAudit({ adminId, action: "badge_claim_link_revoke", targetLabel: id });
  return { ok: true as const };
}

export type ClaimResult = "claimed" | "already" | "invalid" | "expired" | "exhausted";

/** Public preview of a link (no secrets beyond the badge itself). */
export async function previewClaim(token: string) {
  await ensureTables();
  const r = ((await sql`select l.max_claims, l.claims_count, l.expires_at, l.revoked_at,
      b.slug, b.name, b.description, b.image_url, b.kind, b.accent_color, b.motto
    from public.badge_claim_links l join public.custom_badges b on b.id = l.badge_id
    where l.token = ${token} limit 1`) as Row[])[0];
  if (!r) return null;
  const state = claimState({ revoked: r["revoked_at"] != null, expiresAt: iso(r["expires_at"]),
    maxClaims: r["max_claims"] == null ? null : Number(r["max_claims"]), claims: Number(r["claims_count"]) });
  return {
    state,
    badge: {
      slug: String(r["slug"]),
      name: String(r["name"]),
      description: (r["description"] as string | null) ?? null,
      imageUrl: (r["image_url"] as string | null) ?? null,
      kind: (["crest", "emblem", "award", "partner"].includes(String(r["kind"])) ? r["kind"] : "crest") as "crest" | "emblem" | "award" | "partner",
      accentColor: (r["accent_color"] as string | null) ?? null,
      motto: (r["motto"] as string | null) ?? null,
    },
  };
}

/** Lock first, then take a fresh READ COMMITTED snapshot in the same gateway transaction. */
export async function redeemClaim(token: string, userId: string): Promise<ClaimResult> {
  await ensureTables();
  const results = await sql.transaction([
    sql`select id from public.badge_claim_links where token = ${token} for update`,
    sql`
    with l as (
      select id, badge_id, reason from public.badge_claim_links
       where token = ${token} and revoked_at is null
         and (expires_at is null or expires_at > now())
         and (max_claims is null or claims_count < max_claims)
          and not exists (select 1 from public.badge_claim_redemptions r where r.link_id = badge_claim_links.id and r.user_id = ${userId})
    ), g as (
      insert into public.user_custom_badges (user_id, badge_id, granted_by, reason)
      select ${userId}, badge_id, null, reason from l
      on conflict (user_id, badge_id) do nothing returning badge_id
    ), r as (
      insert into public.badge_claim_redemptions (link_id, user_id)
       select l.id, ${userId} from l join g on g.badge_id = l.badge_id
       on conflict do nothing returning link_id
    ), c as (
      update public.badge_claim_links set claims_count = claims_count + 1 where id in (select link_id from r) returning id
    )
    select case
      when exists (select 1 from r) then 'claimed'
      when exists (select 1 from public.user_custom_badges u join public.badge_claim_links b on b.badge_id = u.badge_id where b.token = ${token} and u.user_id = ${userId})
        or exists (select 1 from l) then 'already'
      when not exists (select 1 from public.badge_claim_links where token = ${token} and revoked_at is null) then 'invalid'
      when exists (select 1 from public.badge_claim_links where token = ${token} and expires_at <= now()) then 'expired'
      else 'exhausted' end as result
  `]);
  return (results[1]?.[0]?.["result"] ?? "invalid") as ClaimResult;
}
