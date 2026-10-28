import { sql } from "@/lib/neon";
import { runSchemaEnsure } from "@/lib/db/schema-ensure.server";
import { DIDIT_MONTHLY_LIMIT, monthKey, normalizeRealName, type IdentityProvider } from "./identity-rules";

let ready: Promise<void> | null = null;
function ensure() {
  // Safety net only; db/81 is the source of truth (enum + immutability trigger).
  ready ??= runSchemaEnsure(async () => {
    await sql`create table if not exists public.didit_monthly_usage (
      month date primary key, success_count integer not null default 0)`;
  }, "identity");
  return ready;
}

/** Server-side pepper; ruwe provider-ID's worden nooit opgeslagen. */
function pepper(): string {
  const p = process.env["IDENTITY_HASH_PEPPER"];
  if (!p) throw new Error("identity_not_configured");
  return p;
}

export async function hashHumanId(provider: IdentityProvider, rawId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // W-pairwise-ID's en documenthashes vormen aparte naamruimtes.
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${provider}:${rawId.trim().toUpperCase()}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function providerConfigured(provider: IdentityProvider): boolean {
  if (!process.env["IDENTITY_HASH_PEPPER"]) return false;
  if (provider === "w_identity")
    return Boolean(process.env["W_IDENTITY_ISSUER"] && process.env["W_IDENTITY_CLIENT_ID"] && process.env["W_IDENTITY_CLIENT_SECRET"]);
  if (provider === "didit")
    return Boolean(process.env["DIDIT_API_KEY"] && process.env["DIDIT_WORKFLOW_ID"] && process.env["DIDIT_WEBHOOK_SECRET"]);
  return true;
}

export async function diditSuccessCount(): Promise<number> {
  await ensure();
  const rows = (await sql`select success_count from public.didit_monthly_usage where month = ${monthKey()}`) as { success_count: number }[];
  return Number(rows[0]?.success_count ?? 0);
}

export async function getIdentityStatus(userId: string) {
  const rows = (await sql`select is_verified, verified_real_name, verification_provider, verified_at
    from public.identity_verifications where user_id = ${userId}`.catch(() => [])) as Record<string, unknown>[];
  const r = rows[0];
  return {
    isVerified: Boolean(r?.["is_verified"]),
    verifiedRealName: (r?.["verified_real_name"] as string | null) ?? null,
    provider: (r?.["verification_provider"] as IdentityProvider | null) ?? null,
    verifiedAt: r?.["verified_at"] ? String(r["verified_at"]) : null,
  };
}

export async function createSession(userId: string, provider: IdentityProvider, codeVerifier: string | null) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const state = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await sql`delete from public.identity_verification_sessions where expires_at < now()`;
  await sql`insert into public.identity_verification_sessions (state, user_id, provider, code_verifier, expires_at)
    values (${state}, ${userId}, ${provider}, ${codeVerifier}, now() + interval '30 minutes')`;
  return state;
}

/** Single-use: verwijdert de sessie en geeft eigenaar terug. */
export async function consumeSession(state: string, provider: IdentityProvider) {
  const rows = (await sql`delete from public.identity_verification_sessions
    where state = ${state} and provider = ${provider} and expires_at > now()
    returning user_id, code_verifier`) as { user_id: string; code_verifier: string | null }[];
  return rows[0] ?? null;
}

export type CompleteResult = { ok: true } | { ok: false; reason: "duplicate_human" | "already_verified" | "invalid_name" | "limit_reached" };

/**
 * Markeert een gebruiker als geverifieerd. De UNIQUE-constraint op
 * unique_human_id handhaaft "1 account per persoon"; de geverifieerde naam
 * overschrijft de profielnaam. Voor Didit wordt de maandteller in dezelfde
 * statement verhoogd (alleen bij succes, en nooit boven de limiet).
 */
export async function completeVerification(input: {
  userId: string;
  provider: IdentityProvider;
  rawHumanId: string;
  realName: string;
}): Promise<CompleteResult> {
  await ensure();
  const name = normalizeRealName(input.realName);
  if (!name) return { ok: false, reason: "invalid_name" };
  const humanId = await hashHumanId(input.provider, input.rawHumanId);

  const existing = await getIdentityStatus(input.userId);
  if (existing.isVerified) return { ok: false, reason: "already_verified" };

  if (input.provider === "didit") {
    const bumped = (await sql`insert into public.didit_monthly_usage (month, success_count) values (${monthKey()}, 1)
      on conflict (month) do update set success_count = didit_monthly_usage.success_count + 1
      where didit_monthly_usage.success_count < ${DIDIT_MONTHLY_LIMIT}
      returning success_count`) as unknown[];
    if (bumped.length === 0) return { ok: false, reason: "limit_reached" };
  }

  try {
    await sql`insert into public.identity_verifications
        (user_id, is_verified, verified_real_name, verification_provider, unique_human_id, verified_at, updated_at)
      values (${input.userId}, true, ${name}, ${input.provider}, ${humanId}, now(), now())
      on conflict (user_id) do update set is_verified = true, verified_real_name = excluded.verified_real_name,
        verification_provider = excluded.verification_provider, unique_human_id = excluded.unique_human_id,
        verified_at = now(), updated_at = now()
      where identity_verifications.is_verified = false`;
  } catch (error) {
    if (input.provider === "didit") {
      await sql`update public.didit_monthly_usage set success_count = greatest(success_count - 1, 0) where month = ${monthKey()}`;
    }
    if (/duplicate|unique/i.test(String((error as Error)?.message))) return { ok: false, reason: "duplicate_human" };
    throw error;
  }
  await sql`update public.profiles set display_name = ${name}, updated_at = now() where id = ${input.userId}`;
  return { ok: true };
}

/** Voor profielopslag: de onwijzigbare naam, of null. */
export async function lockedRealName(userId: string): Promise<string | null> {
  const s = await getIdentityStatus(userId);
  return s.isVerified ? s.verifiedRealName : null;
}
