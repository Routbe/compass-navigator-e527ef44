import { routHandleClaim } from "./handle-sync";
import { isValidRedirectUri, cleanRedirectUri, findMatchingRedirect, normalizeRedirectUri, redirectUrisMatch } from "./redirect-match";
import { runSchemaEnsure } from "@/lib/db/schema-ensure.server";
/**
 * "Login met ROUT" — native OAuth 2.1 / OIDC provider.
 *
 * Alles wat geheim is blijft hier: clientsecrets worden uitsluitend gehasht
 * bewaard, autorisatiecodes zijn gehasht, eenmalig en kortlevend, PKCE S256 is
 * verplicht en redirect-URI's worden exact vergeleken. De ondertekensleutel is
 * asymmetrisch (ES256); alleen de publieke helft verlaat de server via JWKS.
 */
import { sql } from "@/lib/neon";
import { generateClientSecret, hashClientSecret, verifyClientSecret } from "./client-secret";

/** Pepper for client-secret hashes: dedicated env var, else the auth secret. */
async function secretPepper(): Promise<string> {
  const own = process.env["OAUTH_CLIENT_SECRET_PEPPER"];
  if (own && own.length >= 32) return own;
  const { resolveAuthSecret } = await import("@/lib/better-auth.server");
  const resolved = resolveAuthSecret();
  if (!resolved) throw new OAuthError("server_error", "Geheimen kunnen niet veilig bewaard worden: auth-secret ontbreekt.");
  return resolved.secret;
}
import { canonicalAppUrl } from "@/lib/app-url";

export const SUPPORTED_SCOPES = ["openid", "profile", "email", "linked_accounts"] as const;
export type Scope = (typeof SUPPORTED_SCOPES)[number];

const CODE_TTL_MS = 60 * 1000;
const ID_TOKEN_TTL_S = 60 * 60;

export type OAuthClient = {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  homepageUrl: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  redirectUris: string[];
  scopes: string[];
  status: string;
  hasSecret: boolean;
  createdAt: string;
  /** `seamless` = direct doorgaan; `strict` = altijd een extra verificatiecode. */
  flowPreference: "seamless" | "strict";
  /** Mag de app (met toestemming van de gebruiker) publieke activiteit ontvangen? */
  richIdentityEnabled: boolean;
  /** Universal Handle Sync: share the @handle as `rout_handle`. */
  handleSyncEnabled: boolean;
  /** `testing` = enkel eigenaar + testgebruikers; `production` = iedereen. */
  publishingStatus: PublishingStatus;
  supportEmail: string | null;
  legalOwner: string | null;
  dpoEmail: string | null;
  /** PKCE S256 verplicht. Uitzetten kan enkel voor apps met een clientsecret. */
  requirePkce: boolean;
  /** Levensduur van access- en id-tokens in seconden. */
  accessTokenTtl: number;
  /** Lege lijst = alle IP's mogen het token-endpoint aanspreken. */
  allowedIps: string[];
  /** Stille herkenning via `prompt=none`. */
  accountDiscoveryEnabled: boolean;
};

export type PublishingStatus = "testing" | "production";
export const MAX_TEST_USERS = 10;
export const TOKEN_TTL_MIN = 300;
export const TOKEN_TTL_MAX = 86400;

export class OAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OAuthError";
  }
}

/* ------------------------------------------------------------------ utils */

const enc = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(new ArrayBuffer(bytes))));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value) as BufferSource);
  return base64url(new Uint8Array(digest));
}

/** Genormaliseerde (maar strikte) vergelijking tegen de whitelist — zie redirect-match.ts. */
export function redirectAllowed(client: OAuthClient, redirectUri: string): boolean {
  return findMatchingRedirect(client.redirectUris, redirectUri) !== null;
}

/** Alleen https in productie; http uitsluitend voor localhost-ontwikkeling. */
export { isValidRedirectUri } from "./redirect-match";

export function issuer(): string {
  // Altijd absoluut (schema + host, zonder afsluitende /) zodat OIDC-clients zoals Keycloak geldige URL's bouwen.
  const raw = (process.env["NEXT_PUBLIC_APP_URL"] || canonicalAppUrl()).trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

let tablesReady = false;
/** Vangnet zodat de console ook werkt vóór migratie 42 handmatig is gedraaid. */
export async function ensureTables(): Promise<void> {
  if (tablesReady) return;
  await runSchemaEnsure(async () => {
  await sql`create table if not exists public.oauth_clients (
    id uuid primary key default gen_random_uuid(),
    owner_user_id uuid not null,
    client_id text not null unique,
    secret_hash text,
    name text not null,
    logo_url text,
    homepage_url text,
    privacy_url text,
    terms_url text,
    redirect_uris text[] not null default '{}',
    scopes text[] not null default '{openid,profile}',
    status text not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    secret_rotated_at timestamptz
  )`;
  await sql`create table if not exists public.oauth_auth_codes (
    code_hash text primary key,
    client_id text not null,
    user_id uuid not null,
    redirect_uri text not null,
    scopes text[] not null default '{}',
    code_challenge text not null,
    nonce text,
    expires_at timestamptz not null,
    consumed_at timestamptz,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists public.oauth_consents (
    user_id uuid not null,
    client_id text not null,
    scopes text[] not null default '{}',
    granted_at timestamptz not null default now(),
    primary key (user_id, client_id)
  )`;
  await sql`create table if not exists public.oauth_signing_keys (
    kid text primary key,
    private_jwk jsonb not null,
    public_jwk jsonb not null,
    created_at timestamptz not null default now(),
    retired_at timestamptz
  )`;
  // Migratie 44 — uitsluitend voor "Login met ROUT" (geen invloed op rout.be-login).
  await sql`alter table public.oauth_clients add column if not exists flow_preference text not null default 'seamless'`;
  await sql`alter table public.oauth_clients add column if not exists rich_identity_enabled boolean not null default false`;
  await sql`alter table public.oauth_clients add column if not exists handle_sync_enabled boolean not null default false`;
  await sql`alter table public.oauth_auth_codes add column if not exists acr text`;
  await sql`alter table public.oauth_auth_codes add column if not exists rich_identity boolean not null default false`;
  await sql`create table if not exists public.oauth_step_up_codes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    client_id text not null,
    code_hash text not null,
    attempts int not null default 0,
    expires_at timestamptz not null,
    verified_at timestamptz,
    consumed_at timestamptz,
    created_at timestamptz not null default now()
  )`;
  // Migratie 50 — Developer Console (publicatie, contact, beveiliging).
  await sql`alter table public.oauth_clients add column if not exists publishing_status text not null default 'testing'`;
  await sql`alter table public.oauth_clients add column if not exists support_email text`;
  await sql`alter table public.oauth_clients add column if not exists legal_owner text`;
  await sql`alter table public.oauth_clients add column if not exists dpo_email text`;
  await sql`alter table public.oauth_clients add column if not exists require_pkce boolean not null default true`;
  await sql`alter table public.oauth_clients add column if not exists access_token_ttl integer not null default 3600`;
  await sql`alter table public.oauth_clients add column if not exists allowed_ips text[] not null default '{}'`;
  await sql`alter table public.oauth_clients add column if not exists account_discovery_enabled boolean not null default false`;
  // Migratie 62 — beschrijving (wizard stap 1).
  await sql`alter table public.oauth_clients add column if not exists description text`;
  await sql`create table if not exists public.oauth_client_test_users (
    id uuid primary key default gen_random_uuid(),
    client_id text not null,
    identifier text not null,
    created_at timestamptz not null default now(),
    unique (client_id, identifier)
  )`;
  await sql`create table if not exists public.oauth_client_verification_requests (
    id uuid primary key default gen_random_uuid(),
    client_id text not null,
    requested_by uuid not null,
    status text not null default 'pending',
    note text,
    reviewed_by uuid,
    reviewed_at timestamptz,
    created_at timestamptz not null default now()
  )`;
  }, "provider.server.ts");
  tablesReady = true;
}

type Row = Record<string, unknown>;

function toClient(row: Row): OAuthClient {
  return {
    id: String(row["id"]),
    clientId: String(row["client_id"]),
    name: String(row["name"]),
    description: (row["description"] as string | null) ?? null,
    logoUrl: (row["logo_url"] as string | null) ?? null,
    homepageUrl: (row["homepage_url"] as string | null) ?? null,
    privacyUrl: (row["privacy_url"] as string | null) ?? null,
    termsUrl: (row["terms_url"] as string | null) ?? null,
    redirectUris: (row["redirect_uris"] as string[] | null) ?? [],
    scopes: (row["scopes"] as string[] | null) ?? [],
    status: String(row["status"] ?? "active"),
    hasSecret: Boolean(row["secret_hash"]),
    createdAt: new Date(row["created_at"] as string).toISOString(),
    flowPreference: row["flow_preference"] === "strict" ? "strict" : "seamless",
    richIdentityEnabled: Boolean(row["rich_identity_enabled"]),
    handleSyncEnabled: Boolean(row["handle_sync_enabled"]),
    publishingStatus: row["publishing_status"] === "production" ? "production" : "testing",
    supportEmail: (row["support_email"] as string | null) ?? null,
    legalOwner: (row["legal_owner"] as string | null) ?? null,
    dpoEmail: (row["dpo_email"] as string | null) ?? null,
    requirePkce: row["require_pkce"] === undefined ? true : Boolean(row["require_pkce"]),
    accessTokenTtl: Number(row["access_token_ttl"] ?? ID_TOKEN_TTL_S) || ID_TOKEN_TTL_S,
    allowedIps: (row["allowed_ips"] as string[] | null) ?? [],
    accountDiscoveryEnabled: Boolean(row["account_discovery_enabled"]),
  };
}

/* ----------------------------------------------------------------- client */

export async function listClients(ownerUserId: string): Promise<OAuthClient[]> {
  await ensureTables();
  const rows = (await sql`select * from public.oauth_clients
    where owner_user_id = ${ownerUserId} order by created_at desc`) as Row[];
  return rows.map(toClient);
}

export async function getClientByClientId(clientId: string): Promise<OAuthClient | null> {
  await ensureTables();
  const rows = (await sql`select * from public.oauth_clients
    where client_id = ${clientId} limit 1`) as Row[];
  return rows[0] ? toClient(rows[0]) : null;
}

export type ClientInput = {
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  homepageUrl?: string | null;
  privacyUrl?: string | null;
  termsUrl?: string | null;
  redirectUris: string[];
  scopes: string[];
  flowPreference?: "seamless" | "strict";
  richIdentityEnabled?: boolean;
  handleSyncEnabled?: boolean;
};

function sanitize(input: ClientInput) {
  // Opschonen + dedupliceren op genormaliseerde vorm (spaties, onzichtbare tekens, geëncodeerde plak).
  const seen = new Set<string>();
  const uris = input.redirectUris
    .map((u) => cleanRedirectUri(u))
    .filter((u) => {
      const key = normalizeRedirectUri(u) ?? u;
      if (!u || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const bad = uris.find((u) => !isValidRedirectUri(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `Ongeldige redirect-URI: ${bad}`);
  const scopes = [...new Set(input.scopes.filter((s) => SUPPORTED_SCOPES.includes(s as Scope)))];
  if (!scopes.includes("openid")) scopes.unshift("openid");
  const name = input.name.trim();
  if (!name) throw new OAuthError("invalid_name", "Geef je app een naam.");
  return { name, uris: uris.map((uri) => normalizeRedirectUri(uri)!), scopes };
}

export async function createClient(
  ownerUserId: string,
  input: ClientInput,
): Promise<{ client: OAuthClient; clientSecret: string }> {
  await ensureTables();
  const { name, uris, scopes } = sanitize(input);
  const clientId = `rout_${randomToken(16)}`;
  const clientSecret = generateClientSecret();
  const secretHash = await hashClientSecret(clientSecret, await secretPepper());
  const rows = (await sql`insert into public.oauth_clients
    (owner_user_id, client_id, secret_hash, name, logo_url, homepage_url, privacy_url, terms_url, redirect_uris, scopes)
    values (${ownerUserId}, ${clientId}, ${secretHash}, ${name}, ${input.logoUrl ?? null},
            ${input.homepageUrl ?? null}, ${input.privacyUrl ?? null}, ${input.termsUrl ?? null},
            ${uris}, ${scopes})
    returning *`) as Row[];
  const created = rows[0]!;
  if (input.description) {
    await sql`update public.oauth_clients set description = ${input.description.trim().slice(0, 500)}
      where id = ${created["id"] as string}`;
    created["description"] = input.description.trim().slice(0, 500);
  }
  if (input.flowPreference || input.richIdentityEnabled !== undefined) {
    const updated = (await sql`update public.oauth_clients set
        flow_preference = ${input.flowPreference === "strict" ? "strict" : "seamless"},
        rich_identity_enabled = ${Boolean(input.richIdentityEnabled)}
      where id = ${created["id"] as string} returning *`) as Row[];
    return { client: toClient(updated[0]!), clientSecret };
  }
  return { client: toClient(created), clientSecret };
}

export async function updateClient(
  ownerUserId: string,
  id: string,
  input: ClientInput,
): Promise<OAuthClient> {
  await ensureTables();
  const { name, uris, scopes } = sanitize(input);
  const rows = (await sql`update public.oauth_clients set
      name = ${name}, logo_url = ${input.logoUrl ?? null},
      homepage_url = ${input.homepageUrl ?? null}, privacy_url = ${input.privacyUrl ?? null},
      terms_url = ${input.termsUrl ?? null},
      description = coalesce(${input.description ?? null}, description), redirect_uris = ${uris}, scopes = ${scopes},
      flow_preference = coalesce(${input.flowPreference ?? null}, flow_preference),
      rich_identity_enabled = coalesce(${input.richIdentityEnabled ?? null}::boolean, rich_identity_enabled),
      handle_sync_enabled = coalesce(${input.handleSyncEnabled ?? null}::boolean, handle_sync_enabled),
      updated_at = now()
    where id = ${id} and owner_user_id = ${ownerUserId} returning *`) as Row[];
  if (!rows[0]) throw new OAuthError("not_found", "Deze app bestaat niet (meer).");
  return toClient(rows[0]);
}

/** Console-instellingen (db/50). Enkel meegegeven velden veranderen. */
export type ClientSettings = Partial<{
  publishingStatus: PublishingStatus;
  supportEmail: string | null;
  legalOwner: string | null;
  dpoEmail: string | null;
  requirePkce: boolean;
  accessTokenTtl: number;
  allowedIps: string[];
  accountDiscoveryEnabled: boolean;
}>;

export async function updateClientSettings(
  ownerUserId: string,
  id: string,
  s: ClientSettings,
): Promise<OAuthClient> {
  await ensureTables();
  const current = (await sql`select * from public.oauth_clients
    where id = ${id} and owner_user_id = ${ownerUserId} limit 1`) as Row[];
  if (!current[0]) throw new OAuthError("not_found", "Deze app bestaat niet (meer).");
  const c = toClient(current[0]);
  const next = {
    publishingStatus: s.publishingStatus ?? c.publishingStatus,
    supportEmail: s.supportEmail !== undefined ? s.supportEmail : c.supportEmail,
    legalOwner: s.legalOwner !== undefined ? s.legalOwner : c.legalOwner,
    dpoEmail: s.dpoEmail !== undefined ? s.dpoEmail : c.dpoEmail,
    requirePkce: s.requirePkce ?? c.requirePkce,
    accessTokenTtl: s.accessTokenTtl ?? c.accessTokenTtl,
    allowedIps: s.allowedIps ?? c.allowedIps,
    accountDiscoveryEnabled: s.accountDiscoveryEnabled ?? c.accountDiscoveryEnabled,
  };
  if (!next.requirePkce && !c.hasSecret) {
    throw new OAuthError("invalid_settings", "PKCE uitzetten kan enkel voor apps met een clientsecret.");
  }
  if (next.publishingStatus === "production" && (!next.supportEmail || !next.legalOwner)) {
    throw new OAuthError("invalid_settings", "Vul eerst een support-e-mail en juridische eigenaar in.");
  }
  if (next.accessTokenTtl < TOKEN_TTL_MIN || next.accessTokenTtl > TOKEN_TTL_MAX) {
    throw new OAuthError("invalid_settings", "Tokenlevensduur moet tussen 5 minuten en 24 uur liggen.");
  }
  const rows = (await sql`update public.oauth_clients set
      publishing_status = ${next.publishingStatus}, support_email = ${next.supportEmail},
      legal_owner = ${next.legalOwner}, dpo_email = ${next.dpoEmail},
      require_pkce = ${next.requirePkce}, access_token_ttl = ${next.accessTokenTtl},
      allowed_ips = ${next.allowedIps}, account_discovery_enabled = ${next.accountDiscoveryEnabled},
      updated_at = now()
    where id = ${id} and owner_user_id = ${ownerUserId} returning *`) as Row[];
  return toClient(rows[0]!);
}

async function ownedClientId(ownerUserId: string, id: string): Promise<string> {
  const rows = (await sql`select client_id from public.oauth_clients
    where id = ${id} and owner_user_id = ${ownerUserId} limit 1`) as Row[];
  if (!rows[0]) throw new OAuthError("not_found", "Deze app bestaat niet (meer).");
  return String(rows[0]["client_id"]);
}

/* ------------------------------------------------------- test users ----- */

export async function listTestUsers(ownerUserId: string, id: string): Promise<string[]> {
  await ensureTables();
  const clientId = await ownedClientId(ownerUserId, id);
  const rows = (await sql`select identifier from public.oauth_client_test_users
    where client_id = ${clientId} order by created_at`) as Row[];
  return rows.map((r) => String(r["identifier"]));
}

export async function addTestUser(ownerUserId: string, id: string, identifier: string) {
  await ensureTables();
  const clientId = await ownedClientId(ownerUserId, id);
  const count = (await sql`select count(*)::int as n from public.oauth_client_test_users
    where client_id = ${clientId}`) as Row[];
  if (Number(count[0]?.["n"] ?? 0) >= MAX_TEST_USERS) {
    throw new OAuthError("limit", `Maximaal ${MAX_TEST_USERS} testgebruikers.`);
  }
  await sql`insert into public.oauth_client_test_users (client_id, identifier)
    values (${clientId}, ${identifier.toLowerCase()}) on conflict do nothing`;
}

export async function removeTestUser(ownerUserId: string, id: string, identifier: string) {
  await ensureTables();
  const clientId = await ownedClientId(ownerUserId, id);
  await sql`delete from public.oauth_client_test_users
    where client_id = ${clientId} and identifier = ${identifier.toLowerCase()}`;
}

/** First-party platform clients (no owner, e.g. `rout_native_self`) are never in test mode. */
export const SYSTEM_CLIENT_IDS = new Set(["rout_native_self"]);

/** Testing-modus: enkel eigenaar en testgebruikers (e-mail of handle) mogen inloggen. */
export async function userMayUseClient(
  client: OAuthClient,
  user: { id: string; email: string },
): Promise<boolean> {
  if (client.publishingStatus === "production") return true;
  if (SYSTEM_CLIENT_IDS.has(client.clientId)) return true;
  const owner = (await sql`select owner_user_id from public.oauth_clients
    where client_id = ${client.clientId} limit 1`) as Row[];
  // Platform login (owner null) is ROUT's own sign-in, not a developer app.
  if (owner[0] && owner[0]["owner_user_id"] == null) return true;
  if (String(owner[0]?.["owner_user_id"]) === user.id) return true;
  let handles: Row[] = [];
  try {
    handles = (await sql`select lower(username) as h from public.profiles
      where (user_id = ${user.id} or id = ${user.id}) and username is not null`) as Row[];
  } catch {
    handles = [];
  }
  const ids = [user.email.toLowerCase(), ...handles.map((r) => String(r["h"]))];
  const hit = (await sql`select 1 from public.oauth_client_test_users
    where client_id = ${client.clientId} and identifier = any(${ids}) limit 1`) as Row[];
  return hit.length > 0;
}

/* ----------------------------------------------------- verification ----- */

export type VerificationStatus = "none" | "pending" | "verified" | "rejected";

export async function latestVerification(ownerUserId: string, id: string) {
  await ensureTables();
  const clientId = await ownedClientId(ownerUserId, id);
  const rows = (await sql`select status, created_at, reviewed_at
    from public.oauth_client_verification_requests
    where client_id = ${clientId} order by created_at desc limit 1`) as Row[];
  const r = rows[0];
  return {
    status: (r ? String(r["status"]) : "none") as VerificationStatus,
    requestedAt: r ? new Date(r["created_at"] as string).toISOString() : null,
    reviewedAt: r?.["reviewed_at"] ? new Date(r["reviewed_at"] as string).toISOString() : null,
  };
}

export async function requestVerification(ownerUserId: string, id: string, note: string) {
  await ensureTables();
  const clientId = await ownedClientId(ownerUserId, id);
  const client = await getClientByClientId(clientId);
  if (!client?.supportEmail || !client.legalOwner || !client.privacyUrl) {
    throw new OAuthError("incomplete", "Vul eerst support-e-mail, juridische eigenaar en privacybeleid in.");
  }
  const open = (await sql`select 1 from public.oauth_client_verification_requests
    where client_id = ${clientId} and status in ('pending','verified') limit 1`) as Row[];
  if (open.length) throw new OAuthError("exists", "Er loopt al een aanvraag of de app is al geverifieerd.");
  await sql`insert into public.oauth_client_verification_requests (client_id, requested_by, note)
    values (${clientId}, ${ownerUserId}, ${note || null})`;
}

/** Enkel aanroepen nadat de beheerdersrol server-side is gecontroleerd. */
export async function listPendingVerifications() {
  await ensureTables();
  const rows = (await sql`select r.id, r.client_id, r.note, r.created_at, c.name, c.homepage_url,
      c.privacy_url, c.support_email, c.legal_owner
    from public.oauth_client_verification_requests r
    join public.oauth_clients c on c.client_id = r.client_id
    where r.status = 'pending' order by r.created_at`) as Row[];
  return rows.map((r) => ({
    id: String(r["id"]),
    clientId: String(r["client_id"]),
    name: String(r["name"]),
    note: (r["note"] as string | null) ?? null,
    homepageUrl: (r["homepage_url"] as string | null) ?? null,
    privacyUrl: (r["privacy_url"] as string | null) ?? null,
    supportEmail: (r["support_email"] as string | null) ?? null,
    legalOwner: (r["legal_owner"] as string | null) ?? null,
    createdAt: new Date(r["created_at"] as string).toISOString(),
  }));
}

export async function reviewVerification(reviewerId: string, requestId: string, approve: boolean) {
  await ensureTables();
  await sql`update public.oauth_client_verification_requests
    set status = ${approve ? "verified" : "rejected"}, reviewed_by = ${reviewerId}, reviewed_at = now()
    where id = ${requestId} and status = 'pending'`;
}

export async function isVerifiedApp(clientId: string): Promise<boolean> {
  try {
    const rows = (await sql`select 1 from public.oauth_client_verification_requests
      where client_id = ${clientId} and status = 'verified' limit 1`) as Row[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------- insights ---- */

export async function clientInsights(ownerUserId: string, id: string) {
  await ensureTables();
  const clientId = await ownedClientId(ownerUserId, id);
  const users = (await sql`select count(*)::int as n from public.oauth_consents
    where client_id = ${clientId}`) as Row[];
  const codes = (await sql`select
      count(*)::int as total,
      count(*) filter (where consumed_at is null and expires_at < now())::int as failed
    from public.oauth_auth_codes
    where client_id = ${clientId} and created_at > now() - interval '30 days'`) as Row[];
  const total = Number(codes[0]?.["total"] ?? 0);
  const failed = Number(codes[0]?.["failed"] ?? 0);
  return {
    activeUsers: Number(users[0]?.["n"] ?? 0),
    requests30d: total,
    errorRate: total ? Math.round((failed / total) * 1000) / 10 : 0,
  };
}

/** Exacte IP-match tegen de allowlist (leeg = alles toegestaan). */
export function ipAllowed(client: OAuthClient, ip: string | null): boolean {
  if (client.allowedIps.length === 0) return true;
  return Boolean(ip) && client.allowedIps.includes(ip!);
}

export async function deleteClient(ownerUserId: string, id: string): Promise<void> {
  await ensureTables();
  await sql`delete from public.oauth_clients where id = ${id} and owner_user_id = ${ownerUserId}`;
}

export async function rotateClientSecret(ownerUserId: string, id: string): Promise<string> {
  await ensureTables();
  const clientSecret = generateClientSecret();
  const secretHash = await hashClientSecret(clientSecret, await secretPepper());
  const rows = (await sql`update public.oauth_clients
    set secret_hash = ${secretHash}, secret_rotated_at = now(), updated_at = now()
    where id = ${id} and owner_user_id = ${ownerUserId} returning id`) as Row[];
  if (!rows[0]) throw new OAuthError("not_found", "Deze app bestaat niet (meer).");
  return clientSecret;
}

/* ------------------------------------------------------------------ codes */

export async function issueAuthorizationCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  nonce?: string | null;
  acr?: string | null;
  richIdentity?: boolean;
}): Promise<string> {
  await ensureTables();
  const code = randomToken(32);
  const hash = await sha256Base64Url(code);
  const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await sql`insert into public.oauth_auth_codes
    (code_hash, client_id, user_id, redirect_uri, scopes, code_challenge, nonce, expires_at, acr, rich_identity)
    values (${hash}, ${input.clientId}, ${input.userId}, ${input.redirectUri},
            ${input.scopes}, ${input.codeChallenge}, ${input.nonce ?? null}, ${expires},
            ${input.acr ?? null}, ${Boolean(input.richIdentity)})`;
  return code;
}

export async function rememberConsent(userId: string, clientId: string, scopes: string[]) {
  await sql`insert into public.oauth_consents (user_id, client_id, scopes)
    values (${userId}, ${clientId}, ${scopes})
    on conflict (user_id, client_id) do update set scopes = excluded.scopes, granted_at = now()`;
}

async function consumeCode(code: string) {
  const hash = await sha256Base64Url(code);
  const rows = (await sql`update public.oauth_auth_codes set consumed_at = now()
    where code_hash = ${hash} and consumed_at is null and expires_at > now()
    returning *`) as Row[];
  if (!rows[0]) throw new OAuthError("invalid_grant", "Deze autorisatiecode is ongeldig of al gebruikt.");
  return rows[0];
}

/* ----------------------------------------------------------- signing keys */

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
type KeyRecord = { kid: string; privateJwk: Jwk; publicJwk: Jwk };

async function activeKey(): Promise<KeyRecord> {
  await ensureTables();
  const rows = (await sql`select * from public.oauth_signing_keys
    where retired_at is null order by created_at desc limit 1`) as Row[];
  if (rows[0]) {
    return {
      kid: String(rows[0]["kid"]),
      privateJwk: rows[0]["private_jwk"] as Jwk,
      publicJwk: rows[0]["public_jwk"] as Jwk,
    };
  }
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kid = randomToken(8);
  const withMeta: Jwk = { ...publicJwk, kid, alg: "ES256", use: "sig" };
  await sql`insert into public.oauth_signing_keys (kid, private_jwk, public_jwk)
    values (${kid}, ${JSON.stringify({ ...privateJwk, kid })}, ${JSON.stringify(withMeta)})`;
  return { kid, privateJwk: { ...privateJwk, kid }, publicJwk: withMeta };
}

export async function publicJwks(): Promise<{ keys: Jwk[] }> {
  await ensureTables();
  const rows = (await sql`select public_jwk from public.oauth_signing_keys
    where retired_at is null order by created_at desc`) as Row[];
  if (rows.length === 0) return { keys: [(await activeKey()).publicJwk] };
  return { keys: rows.map((r) => r["public_jwk"] as Jwk) };
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const key = await activeKey();
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = { alg: "ES256", typ: "JWT", kid: key.kid };
  const body = `${base64url(enc.encode(JSON.stringify(header)))}.${base64url(enc.encode(JSON.stringify(payload)))}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      enc.encode(body) as BufferSource,
    ),
  );
  return `${body}.${base64url(signature)}`;
}

/* ------------------------------------------------------------ token grant */

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  clientSecret?: string | null;
  redirectUri: string;
  codeVerifier: string | null;
  clientIp?: string | null;
}) {
  const client = await getClientByClientId(input.clientId);
  if (!client || client.status !== "active") {
    throw new OAuthError("invalid_client", "Onbekende app.");
  }
  if (!ipAllowed(client, input.clientIp ?? null)) {
    throw new OAuthError("invalid_client", "Dit IP-adres mag geen tokens ophalen voor deze app.");
  }
  const stored = (await sql`select secret_hash from public.oauth_clients
    where client_id = ${input.clientId} limit 1`) as Row[];
  const secretHash = (stored[0]?.["secret_hash"] as string | null) ?? null;
  let secretVerified = false;
  if (secretHash) {
    const ok = input.clientSecret
      ? await verifyClientSecret(input.clientSecret, secretHash, await secretPepper())
      : false;
    if (!ok) throw new OAuthError("invalid_client", "Clientsecret klopt niet.");
    secretVerified = true;
  }

  const row = await consumeCode(input.code);
  if (String(row["client_id"]) !== input.clientId) {
    throw new OAuthError("invalid_grant", "Deze code hoort bij een andere app.");
  }
  if (!redirectUrisMatch(String(row["redirect_uri"]), input.redirectUri)) {
    console.error(
      `[OIDC Token] redirect_uri mismatch for client ${input.clientId}. Authorize used: ${JSON.stringify(String(row["redirect_uri"]))} | Token request: ${JSON.stringify(input.redirectUri)}`,
    );
    throw new OAuthError("invalid_grant", "De redirect-URI komt niet overeen.");
  }
  const storedChallenge = String(row["code_challenge"] ?? "");
  if (storedChallenge) {
    // Code werd met PKCE uitgegeven: de verifier is altijd verplicht.
    if (!input.codeVerifier) throw new OAuthError("invalid_grant", "code_verifier ontbreekt.");
    if ((await sha256Base64Url(input.codeVerifier)) !== storedChallenge) {
      throw new OAuthError("invalid_grant", "PKCE-controle mislukt.");
    }
  } else if (client.requirePkce || !secretVerified) {
    // Zonder PKCE enkel voor vertrouwelijke apps die PKCE expliciet uitzetten.
    throw new OAuthError("invalid_grant", "PKCE is verplicht voor deze app.");
  }
  const ttl = Math.min(Math.max(client.accessTokenTtl, TOKEN_TTL_MIN), TOKEN_TTL_MAX);

  const userId = String(row["user_id"]);
  const scopes = (row["scopes"] as string[] | null) ?? [];
  const claims = await identityClaims(userId, scopes, { handleSync: client.handleSyncEnabled });
  // Rich Identity: enkel als de app het aanzette én de gebruiker het aanvinkte.
  if (row["rich_identity"] && client.richIdentityEnabled) {
    try {
      const { readPublicTimeline } = await import("@/lib/public-timeline.server");
      claims["rout_public_activity"] = (await readPublicTimeline(userId)).map((i) => ({
        kind: i.kind,
        title: i.title,
        occurred_at: i.occurred_at,
      }));
    } catch {
      claims["rout_public_activity"] = [];
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const idToken = await signJwt({
    iss: issuer(),
    sub: userId,
    aud: input.clientId,
    iat: now,
    exp: now + ttl,
    ...(row["nonce"] ? { nonce: String(row["nonce"]) } : {}),
    ...(row["acr"] ? { acr: String(row["acr"]) } : {}),
    ...claims,
  });
  const accessToken = await signJwt({
    iss: issuer(),
    sub: userId,
    aud: input.clientId,
    scope: scopes.join(" "),
    iat: now,
    exp: now + ttl,
  });
  return {
    access_token: accessToken,
    id_token: idToken,
    token_type: "Bearer",
    expires_in: ttl,
    scope: scopes.join(" "),
  };
}

/** Claims volgens de toegestane scopes; `sub` blijft het interne gebruikers-id. */
export async function identityClaims(
  userId: string,
  scopes: string[],
  opts: { handleSync?: boolean } = {},
): Promise<Record<string, unknown>> {
  const rows = (await sql`select u.email, u.email_confirmed_at, p.username, p.display_name, p.avatar_url
    from public.users u left join public.profiles p on p.user_id = u.id
    where u.id = ${userId} limit 1`) as Row[];
  const row = rows[0];
  if (!row) return {};
  const claims: Record<string, unknown> = {};
  if (scopes.includes("profile")) {
    claims["preferred_username"] = row["username"] ?? null;
    claims["name"] = row["display_name"] ?? null;
    claims["picture"] = row["avatar_url"] ?? null;
  }
  const handle = routHandleClaim(Boolean(opts.handleSync), scopes, row["username"]);
  if (handle !== undefined) claims["rout_handle"] = handle;
  if (scopes.includes("email")) {
    claims["email"] = row["email"] ?? null;
    claims["email_verified"] = Boolean(row["email_confirmed_at"]);
  }
  if (scopes.includes("linked_accounts")) {
    // Alleen dienst + account-ID: genoeg om dubbele accounts bij de app te voorkomen.
    claims["linked_accounts"] = await linkedAccountsOf(userId);
  }
  return claims;
}

/** Social sign-ins on this member: Better Auth accounts + fediverse identities. Never tokens. */
export async function linkedAccountsOf(
  userId: string,
): Promise<Array<{ provider: string; account_id: string }>> {
  const out: Array<{ provider: string; account_id: string }> = [];
  const seen = new Set<string>();
  const add = (provider: unknown, id: unknown) => {
    const p = String(provider ?? "").toLowerCase();
    const a = String(id ?? "");
    if (!p || !a || p === "credential" || p === "email") return;
    const key = `${p}:${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ provider: p, account_id: a });
  };
  try {
    const ba = (await sql`select a."providerId" as p, a."accountId" as a
      from public.users u join neon_auth.account a on a."userId"::text = u.user_metadata->>'neon_auth_id'
      where u.id = ${userId} order by a."createdAt"`) as Row[];
    ba.forEach((r) => add(r["p"], r["a"]));
  } catch (e) {
    console.warn("[oauth] linked accounts (auth) skipped:", (e as Error).message);
  }
  try {
    const fedi = (await sql`select provider, provider_account_id from public.user_identities
      where user_id = ${userId} order by provider, created_at`) as Row[];
    fedi.forEach((r) => add(r["provider"], r["provider_account_id"]));
  } catch {
    /* optional table */
  }
  return out;
}

/* ----------------------------------------------------- toegang & userinfo */

/** De console staat alleen open voor geverifieerde (betalende) leden. */
export async function isVerifiedDeveloper(userId: string): Promise<boolean> {
  const { canUseDeveloperConsole } = await import("./console-access-rules");
  // Each signal is read separately so a missing optional column/table never
  // turns into a false "not verified".
  const safe = async (q: () => Promise<unknown>): Promise<Row[]> => {
    try {
      return (await q()) as Row[];
    } catch (error) {
      console.warn("[console-access] signal skipped:", (error as Error).message);
      return [];
    }
  };
  const [profile] = await safe(() =>
    sql`select to_jsonb(p) as p from public.profiles p where p.id = ${userId} limit 1`,
  );
  const p = (profile?.["p"] ?? {}) as Record<string, unknown>;
  const admin = await safe(() =>
    sql`select 1 from public.user_roles where user_id = ${userId} and role::text = 'admin' limit 1`,
  );
  const handle = await safe(() =>
    sql`select 1 from public.approved_handles where user_id = ${userId} and status = 'claimed' limit 1`,
  );
  return canUseDeveloperConsole({
    verified: p["verified"] === true,
    isPaid: p["is_paid"] === true,
    isEarlyBeliever: p["is_early_believer"] === true,
    isBanned: p["is_banned"] === true,
    isSuspended: p["is_suspended"] === true,
    hasClaimedRootHandle: handle.length > 0,
    isAdmin: admin.length > 0,
  });
}

/** Verifieert een door ROUT uitgegeven access-token en geeft sub + scopes terug. */
export async function verifyAccessToken(
  token: string,
): Promise<{ sub: string; scopes: string[]; clientId: string | null }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new OAuthError("invalid_token", "Ongeldig token.");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const fromB64 = (value: string) =>
    Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const header = JSON.parse(new TextDecoder().decode(fromB64(headerPart))) as { kid?: string };
  const { keys } = await publicJwks();
  const jwk = keys.find((k) => k.kid === header.kid) ?? keys[0];
  if (!jwk) throw new OAuthError("invalid_token", "Geen ondertekensleutel gevonden.");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    fromB64(signaturePart) as BufferSource,
    enc.encode(`${headerPart}.${payloadPart}`) as BufferSource,
  );
  if (!ok) throw new OAuthError("invalid_token", "Handtekening klopt niet.");
  const payload = JSON.parse(new TextDecoder().decode(fromB64(payloadPart))) as {
    sub?: string;
    exp?: number;
    scope?: string;
    aud?: string;
  };
  if (!payload.sub) throw new OAuthError("invalid_token", "Token mist een gebruiker.");
  if ((payload.exp ?? 0) * 1000 < Date.now()) {
    throw new OAuthError("invalid_token", "Token is verlopen.");
  }
  return {
    sub: payload.sub,
    scopes: (payload.scope ?? "").split(" ").filter(Boolean),
    clientId: typeof payload.aud === "string" ? payload.aud : null,
  };
}

/** Bestaande toestemming voor deze app, als die alle gevraagde scopes dekt. */
export async function hasConsent(
  userId: string,
  clientId: string,
  scopes: string[],
): Promise<boolean> {
  await ensureTables();
  const rows = (await sql`select scopes from public.oauth_consents
    where user_id = ${userId} and client_id = ${clientId} limit 1`) as Row[];
  const granted = (rows[0]?.["scopes"] as string[] | null) ?? null;
  if (!granted) return false;
  return scopes.every((s) => granted.includes(s));
}

/* -------------------------------------------------------------- step-up */

export async function createStepUpCode(userId: string, clientId: string): Promise<string> {
  await ensureTables();
  const digits = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  const code = String(digits).padStart(6, "0");
  const hash = await sha256Base64Url(`${userId}:${clientId}:${code}`);
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await sql`update public.oauth_step_up_codes set consumed_at = now()
    where user_id = ${userId} and client_id = ${clientId} and consumed_at is null`;
  await sql`insert into public.oauth_step_up_codes (user_id, client_id, code_hash, expires_at)
    values (${userId}, ${clientId}, ${hash}, ${expires})`;
  return code;
}

/** Controleert de code (max. 5 pogingen, 10 min geldig) en markeert hem als geverifieerd. */
export async function verifyStepUpCode(userId: string, clientId: string, code: string) {
  await ensureTables();
  const rows = (await sql`select id, code_hash, attempts, expires_at from public.oauth_step_up_codes
    where user_id = ${userId} and client_id = ${clientId} and consumed_at is null and verified_at is null
    order by created_at desc limit 1`) as Row[];
  const row = rows[0];
  const { stepUpCodeState } = await import("./step-up");
  const hash = await sha256Base64Url(`${userId}:${clientId}:${code.trim()}`);
  const state = stepUpCodeState(
    row ? { attempts: Number(row["attempts"]), expiresAt: String(row["expires_at"]), matches: hash === row["code_hash"] } : null,
    Date.now(),
  );
  if (!row) return state;
  if (state === "ok") {
    await sql`update public.oauth_step_up_codes set verified_at = now() where id = ${row["id"] as string}`;
  } else if (state === "wrong") {
    await sql`update public.oauth_step_up_codes set attempts = attempts + 1 where id = ${row["id"] as string}`;
  }
  return state;
}

/** Verbruikt een recent geverifieerde code (eenmalig, binnen 10 minuten). */
export async function consumeVerifiedStepUp(userId: string, clientId: string): Promise<boolean> {
  await ensureTables();
  const rows = (await sql`update public.oauth_step_up_codes set consumed_at = now()
    where id = (select id from public.oauth_step_up_codes
                 where user_id = ${userId} and client_id = ${clientId}
                   and verified_at is not null and consumed_at is null
                   and verified_at > now() - interval '10 minutes'
                 order by verified_at desc limit 1)
    returning id`) as Row[];
  return rows.length > 0;
}
