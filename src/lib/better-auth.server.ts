import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins/magic-link";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { passkey } from "@better-auth/passkey";
import { GatewayPool, databaseTransport, hasDatabase } from "@/lib/neon";
import { APP_DOMAINS } from "@/lib/app-domains";
import { canonicalAppUrl, isApprovedHost } from "@/lib/app-url";

/**
 * Self-hosted Better Auth — ROUT's own identity layer (System A).
 *
 * No managed middleman: Google, GitHub, GitLab, Apple and a generic OIDC
 * provider talk directly to OUR backend with OUR client credentials. Data
 * lives in the existing `neon_auth` schema (the Better Auth table layout), so
 * existing e-mail/password accounts keep working.
 *
 * Providers are only enabled when their credentials are present, so a missing
 * key disables that button instead of crashing sign-in.
 *
 * Cookies: strictly functional (session + OAuth state/CSRF), always
 * HttpOnly + Secure + SameSite=Lax. No trackers, no third-party cookies.
 */

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/** Alternative names people commonly use on Vercel (Auth.js style). */
const ALIASES: Record<string, string[]> = {
  GOOGLE_CLIENT_ID: ["GOOGLE_OAUTH_CLIENT_ID", "AUTH_GOOGLE_ID", "GOOGLE_ID"],
  GOOGLE_CLIENT_SECRET: ["GOOGLE_OAUTH_CLIENT_SECRET", "AUTH_GOOGLE_SECRET", "GOOGLE_SECRET"],
  GITHUB_CLIENT_ID: ["GITHUB_OAUTH_CLIENT_ID", "AUTH_GITHUB_ID", "GITHUB_ID"],
  GITHUB_CLIENT_SECRET: ["GITHUB_OAUTH_CLIENT_SECRET", "AUTH_GITHUB_SECRET", "GITHUB_SECRET"],
  GITLAB_CLIENT_ID: ["GITLAB_OAUTH_CLIENT_ID", "AUTH_GITLAB_ID", "GITLAB_ID"],
  GITLAB_CLIENT_SECRET: ["GITLAB_OAUTH_CLIENT_SECRET", "AUTH_GITLAB_SECRET", "GITLAB_SECRET"],
  APPLE_CLIENT_ID: ["APPLE_OAUTH_CLIENT_ID", "AUTH_APPLE_ID", "APPLE_ID"],
  APPLE_CLIENT_SECRET: ["APPLE_OAUTH_CLIENT_SECRET", "AUTH_APPLE_SECRET", "APPLE_SECRET"],
  BETTER_AUTH_SECRET: ["AUTH_SECRET"],
};

function envAny(name: string): string | undefined {
  return env(name) ?? (ALIASES[name] ?? []).map(env).find(Boolean);
}

/**
 * Better Auth signing secret. Prefers BETTER_AUTH_SECRET/AUTH_SECRET; otherwise
 * derives a stable one from SESSION_SECRET / OAUTH_STATE_SECRET / DATABASE_URL so
 * a missing variable no longer breaks every sign-in (logged as a warning).
 */
export function resolveAuthSecret(): { secret: string; derived: boolean } | null {
  const direct = envAny("BETTER_AUTH_SECRET");
  if (direct && direct.length >= 32) return { secret: direct, derived: false };
  const seed = env("SESSION_SECRET") ?? env("OAUTH_STATE_SECRET") ?? env("DATABASE_URL") ?? env("NEON_API_KEY");
  if (!seed) return null;
  const secret = createHash("sha256").update(`rout-better-auth:${seed}`).digest("hex");
  return { secret, derived: true };
}

function pair(id: string, secret: string) {
  const clientId = envAny(id);
  const clientSecret = envAny(secret);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** First-party publieke PKCE-client voor de native "ROUT ID"-login (db/78). */
export const NATIVE_OIDC_CLIENT_ID = "rout_native_self";

/** oidc is geconfigureerd als álle OIDC_* er zijn, of géén enkele (native fallback). */
function oidcConfigured(): boolean {
  const keys = ["OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_DISCOVERY_URL"];
  const present = keys.filter((k) => Boolean(envAny(k)));
  return present.length === 0 || present.length === keys.length;
}

/** Origin the browser is actually using (proxy-aware: x-forwarded-host/proto). */
function requestOrigin(request?: Request): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || request.headers.get("host") || new URL(request.url).host;
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const fwdProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const proto = fwdProto === "http" || fwdProto === "https" ? fwdProto : local ? "http" : "https";
  // Behind Vercel's proxy the hop may report http; a non-local host is always https.
  return `${local ? proto : "https"}://${host}`;
}

/** The base URL OAuth callbacks are built on: the approved request host first, else configured, else canonical. */
function baseUrlFor(request?: Request): string {
  const configured = env("BETTER_AUTH_URL") ?? env("NEXT_PUBLIC_APP_URL");
  const origin = requestOrigin(request);
  // The state cookie is set on the request host; returning to a different
  // configured host loses it → state_mismatch. Follow the live host instead.
  if (origin && isApprovedHost(new URL(origin).host)) return origin;
  if (configured) {
    const base = configured.trim().replace(/\/+$/, "").replace(/\/api\/auth$/, "");
    const normalized = /^https?:\/\//.test(base) ? base : `https://${base}`;
    if (origin && new URL(origin).host !== new URL(normalized).host) {
      // State cookie is set on the request host but the provider returns to
      // BETTER_AUTH_URL's host → cookie missing → state_mismatch.
      console.warn(`[auth] host mismatch: request=${origin} BETTER_AUTH_URL=${normalized}. OAuth state cookies will not match.`);
    }
    return normalized;
  }
  if (origin && isApprovedHost(new URL(origin).host)) return origin;
  return canonicalAppUrl();
}

export { baseUrlFor as authBaseUrlFor };

/** Canonical https origin (no trailing slash) the OAuth providers are registered on. */
export function canonicalAuthOrigin(): string {
  const raw = (env("BETTER_AUTH_URL") ?? env("NEXT_PUBLIC_APP_URL") ?? canonicalAppUrl()).trim();
  const base = raw.replace(/\/+$/, "").replace(/\/api\/auth$/, "");
  const url = new URL(/^https?:\/\//.test(base) ? base : `https://${base}`);
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  return `${local ? url.protocol.replace(":", "") : "https"}://${url.host}`;
}

/** Exact GitLab redirect_uri: GITLAB_REDIRECT_URI override, else <canonical>/api/auth/callback/gitlab. */
export function gitlabRedirectUri(): string {
  const override = env("GITLAB_REDIRECT_URI")?.trim().replace(/\/+$/, "");
  if (override) return override.replace(/^http:\/\/(?!localhost|127\.0\.0\.1)/, "https://");
  return `${canonicalAuthOrigin()}/api/auth/callback/gitlab`;
}

function gitlabIssuer(): string {
  return (env("GITLAB_ISSUER")?.trim() || "https://gitlab.com").replace(/\/+$/, "");
}

export function createRoutAuth(request?: Request) {
  // Either transport is fine: DATABASE_URL on Vercel, the Neon connector in Lovable.
  if (!hasDatabase()) {
    console.error("[auth] no database configured: set DATABASE_URL (Vercel) or link the Neon connector.");
    throw new Error("DATABASE_URL ontbreekt: geen databaseverbinding ingesteld.");
  }
  const resolved = resolveAuthSecret();
  if (!resolved) throw new Error("BETTER_AUTH_SECRET ontbreekt.");
  if (resolved.derived) console.warn("[auth] BETTER_AUTH_SECRET missing or <32 chars; using derived fallback. Set it on Vercel.");
  const secret = resolved.secret;

  const socialProviders: Record<string, unknown> = {};
  const google = pair("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
  if (google) socialProviders["google"] = { ...google, prompt: "select_account" };
  const github = pair("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET");
  if (github) socialProviders["github"] = github;
  const gitlab = pair("GITLAB_CLIENT_ID", "GITLAB_CLIENT_SECRET");
  if (gitlab) {
    // Pinned so GitLab (Group Application) always sees the exact registered URI,
    // whatever host the visitor used. read_user is added by Better Auth itself.
    socialProviders["gitlab"] = {
      ...gitlab,
      issuer: gitlabIssuer(),
      redirectURI: gitlabRedirectUri(),
      scope: ["openid", "profile", "email"],
    };
  }
  const apple = pair("APPLE_CLIENT_ID", "APPLE_CLIENT_SECRET");
  if (apple) socialProviders["apple"] = { ...apple, appBundleIdentifier: env("APPLE_APP_BUNDLE_IDENTIFIER") };

  const plugins: unknown[] = [
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        // Rondleiding-concept meteen aan dit e-mailadres koppelen, zodat de
        // link ook op een ander toestel alle keuzes terugvindt.
        try {
          const raw = (request?.headers.get("cookie") ?? "")
            .split(";")
            .map((c) => c.trim())
            .find((c) => c.startsWith("rout_tour_draft="));
          const token = raw ? decodeURIComponent(raw.slice("rout_tour_draft=".length)) : "";
          if (token.length >= 8) {
            const { readTourDraftByToken, upsertTourDraft } = await import("@/lib/tour-draft.server");
            const draft = await readTourDraftByToken(token);
            if (draft) await upsertTourDraft(email, draft);
          }
        } catch (err) {
          console.error("[auth] draft link at magic-link send failed", err);
        }
        // Alleen de centrale dienst: taal uit cookie/browser, nooit blokkerend of gooiend.
        const { sendLocalizedEmail, localeFromRequest } = await import("@/lib/email.server");
        const { issueLoginCode } = await import("@/lib/login-code.server");
        const code = await issueLoginCode(email, url);
        await sendLocalizedEmail({
          to: email,
          intent: "magic-link",
          locale: localeFromRequest(request),
          payload: { link: url, code: code ?? undefined },
        });
      },
    }),
  ];

  const genericConfigs: unknown[] = [];
  // "ROUT ID" (voorheen Keycloak): zonder externe OIDC_*-configuratie valt deze
  // provider terug op onze EIGEN sovereign OIDC-provider (publieke PKCE-client
  // `rout_native_self`, geen externe sleutels nodig). Met OIDC_* ingesteld
  // wijst hij naar die externe Keycloak-compatible provider.
  const oidc = pair("OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET");
  const discoveryUrl = env("OIDC_DISCOVERY_URL");
  if (oidc && discoveryUrl) {
    genericConfigs.push({ providerId: "oidc", discoveryUrl, ...oidc, scopes: ["openid", "email", "profile"], pkce: true });
  } else if (!oidc && !discoveryUrl) {
    // Discover on the live (approved) request host so dev/preview never call a dead port.
    const live = requestOrigin(request);
    const issuerBase = live && isApprovedHost(new URL(live).host) ? live : canonicalAppUrl();
    genericConfigs.push({
      providerId: "oidc",
      discoveryUrl: `${issuerBase}/.well-known/openid-configuration`,
      clientId: NATIVE_OIDC_CLIENT_ID,
      scopes: ["openid", "email", "profile"],
      pkce: true,
    });
  }
  // Proton (Zwitserland) — OIDC via discovery. Proton publiceert (nog) geen
  // openbare OIDC voor derden: alleen actief met eigen client + discovery-URL.
  const proton = pair("PROTON_CLIENT_ID", "PROTON_CLIENT_SECRET");
  const protonDiscovery = env("PROTON_DISCOVERY_URL");
  if (proton && protonDiscovery) {
    genericConfigs.push({
      providerId: "proton",
      discoveryUrl: protonDiscovery,
      ...proton,
      scopes: ["openid", "profile", "email"],
      pkce: true,
      mapProfileToUser: (p: Record<string, unknown>) => ({
        email: typeof p["email"] === "string" ? (p["email"] as string).toLowerCase() : undefined,
        name: (p["name"] as string) ?? undefined,
        emailVerified: p["email_verified"] === true,
      }),
    });
  }
  // Infomaniak (Zwitserland) — native OIDC, geen tussenpartij.
  const infomaniak = pair("INFOMANIAK_CLIENT_ID", "INFOMANIAK_CLIENT_SECRET");
  if (infomaniak) {
    genericConfigs.push({
      providerId: "infomaniak",
      ...infomaniak,
      authorizationUrl: "https://login.infomaniak.com/authorize",
      tokenUrl: "https://login.infomaniak.com/token",
      userInfoUrl: "https://login.infomaniak.com/oauth2/userinfo",
      scopes: ["openid", "email", "profile"],
      pkce: true,
      // Snelheid: claims uit het id_token lezen en de extra userinfo-roundtrip
      // naar Infomaniak alleen doen als e-mail daar ontbreekt.
      getUserInfo: async (tokens: { idToken?: string; accessToken?: string }) => {
        let p: Record<string, unknown> = {};
        try {
          const part = tokens.idToken?.split(".")[1];
          if (part) p = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
        } catch {
          p = {};
        }
        if (typeof p["email"] !== "string" && tokens.accessToken) {
          const r = await fetch("https://login.infomaniak.com/oauth2/userinfo", {
            headers: { authorization: `Bearer ${tokens.accessToken}` },
          });
          if (r.ok) p = { ...p, ...((await r.json()) as Record<string, unknown>) };
        }
        const id = p["sub"] ?? p["id"];
        if (!id || typeof p["email"] !== "string") return null;
        return {
          id: String(id),
          email: (p["email"] as string).toLowerCase(),
          name: (p["name"] as string) ?? (p["display_name"] as string) ?? undefined,
          image: (p["picture"] as string) ?? undefined,
          emailVerified: p["email_verified"] === true,
        };
      },
      mapProfileToUser: (p: Record<string, unknown>) => ({
        email: typeof p["email"] === "string" ? (p["email"] as string).toLowerCase() : undefined,
        name: (p["name"] as string) ?? (p["display_name"] as string) ?? undefined,
        image: (p["picture"] as string) ?? undefined,
        // Alleen expliciet bevestigde adressen gelden als geverifieerd.
        emailVerified: p["email_verified"] === true,
      }),
    });
  }
  if (genericConfigs.length) plugins.push(genericOAuth({ config: genericConfigs as never }));

  const origin = requestOrigin(request);

  // Echte 2FA (TOTP, ook voor accounts zonder wachtwoord) en passkeys (WebAuthn).
  plugins.push(
    twoFactor({
      issuer: "ROUT",
      allowPasswordless: true,
      schema: { twoFactor: { modelName: "neon_auth.twoFactor" } },
    } as never),
    passkey({
      rpID: new URL(origin ?? canonicalAppUrl()).hostname,
      rpName: "ROUT",
      origin: origin ?? canonicalAppUrl(),
      schema: { passkey: { modelName: "neon_auth.passkey" } },
    } as never),
  );

  return betterAuth({
    appName: "ROUT",
    baseURL: baseUrlFor(request),
    basePath: "/api/auth",
    secret,
    database: new GatewayPool() as never,
    user: { modelName: "neon_auth.user" },
    session: {
      modelName: "neon_auth.session",
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    account: {
      modelName: "neon_auth.account",
      accountLinking: {
        enabled: true,
        // No trusted providers: at sign-in a social account is only merged into
        // an existing ROUT user when the provider reports the e-mail verified.
        trustedProviders: [],
        // Explicit linking (signed-in member, Settings → Linked identities)
        // may attach an account with a different e-mail.
        allowDifferentEmails: true,
      },
    },
    verification: { modelName: "neon_auth.verification" },
    databaseHooks: {
      session: {
        create: {
          after: async (session: { id: string; userId?: string; userAgent?: string | null }) => {
            if (!session.userId) return;
            const { later, notifyNewSignIn } = await import("./site-mail.server");
            later(() => notifyNewSignIn(session.userId as string, session.id, session.userAgent ?? null));
          },
        },
      },
    },
    emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: true },
    socialProviders: socialProviders as never,
    plugins: plugins as never,
    trustedOrigins: [
      canonicalAppUrl(),
      // Both schemes, apex + wildcards: logins must work on https://rout.be
      // (bare apex, no www) AND http://rout.be without an origin mismatch.
      ...APP_DOMAINS.flatMap((d) => [`https://${d}`, `https://*.${d}`, `http://${d}`, `http://*.${d}`]),
      "http://localhost:8080",
      "http://localhost:*",
      "http://127.0.0.1:*",
      "https://*.lovableproject.com",
      "https://*.lovable.app",
      // Both split deployments (rout.be public, rout.dlp.li admin) + configured base.
      "https://rout.dlp.li",
      "https://www.rout.be",
      ...[env("BETTER_AUTH_URL"), env("NEXT_PUBLIC_APP_URL")].flatMap((u) => {
        try {
          return u ? [new URL(/^https?:\/\//.test(u.trim()) ? u.trim() : `https://${u.trim()}`).origin] : [];
        } catch {
          return [];
        }
      }),
      ...(origin && isApprovedHost(new URL(origin).host) ? [origin] : []),
    ],
    advanced: {
      // Always secure: production is https behind Vercel's proxy even when the
      // internal hop says http; browsers accept secure cookies on localhost.
      useSecureCookies: true,
      // lax lets the top-level OAuth redirect back carry the state cookie.
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"] },
      database: { generateId: () => crypto.randomUUID() },
    },
    telemetry: { enabled: false },
  });
}

/** Which sign-in buttons are actually configured (for the UI). */
export function enabledProviders(): string[] {
  const list: string[] = [];
  if (pair("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")) list.push("google");
  if (pair("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET")) list.push("github");
  if (pair("GITLAB_CLIENT_ID", "GITLAB_CLIENT_SECRET")) list.push("gitlab");
  if (pair("APPLE_CLIENT_ID", "APPLE_CLIENT_SECRET")) list.push("apple");
  if (oidcConfigured()) list.push("oidc");
  if (pair("INFOMANIAK_CLIENT_ID", "INFOMANIAK_CLIENT_SECRET")) list.push("infomaniak");
  if (pair("PROTON_CLIENT_ID", "PROTON_CLIENT_SECRET") && env("PROTON_DISCOVERY_URL")) list.push("proton");
  return list;
}

const PROVIDER_KEYS: Record<string, string[]> = {
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  github: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  gitlab: ["GITLAB_CLIENT_ID", "GITLAB_CLIENT_SECRET"],
  apple: ["APPLE_CLIENT_ID", "APPLE_CLIENT_SECRET"],
  oidc: ["OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_DISCOVERY_URL"],
  infomaniak: ["INFOMANIAK_CLIENT_ID", "INFOMANIAK_CLIENT_SECRET"],
  proton: ["PROTON_CLIENT_ID", "PROTON_CLIENT_SECRET", "PROTON_DISCOVERY_URL"],
};

/** Is a sign-in provider fully configured? Names only — never values. */
export function isProviderConfigured(id: string): boolean {
  if (id === "oidc") return oidcConfigured();
  const keys = PROVIDER_KEYS[id];
  if (!keys) return false;
  return keys.every((k) => Boolean(envAny(k)));
}

/** Key NAMES a provider still misses — safe for logs and diagnostics. */
export function missingProviderKeys(id: string): string[] {
  if (id === "oidc") return oidcConfigured() ? [] : PROVIDER_KEYS["oidc"]!.filter((k) => !envAny(k));
  const keys = PROVIDER_KEYS[id];
  return keys ? keys.filter((k) => !envAny(k)) : ["*"];
}

/** Live checks for the deploy: database reachable, email service configured. */
export async function liveAuthChecks() {
  let database = false;
  let databaseError: string | null = null;
  try {
    if (hasDatabase()) {
      const pool = new GatewayPool();
      await pool.query("select 1 from neon_auth.verification limit 1");
      database = true;
    }
  } catch (e) {
    databaseError = e instanceof Error ? e.message.slice(0, 120) : "unknown";
  }
  return { database, databaseError, databaseTransport: databaseTransport(), emailService: Boolean(env("BREVO_API_KEY")) };
}

/** Diagnostic report — names only, never values. */
export function authDiagnostics(request?: Request) {
  const base = baseUrlFor(request);
  const resolved = resolveAuthSecret();
  const core = {
    DATABASE_URL: hasDatabase(),
    BETTER_AUTH_SECRET: Boolean(resolved),
    BETTER_AUTH_URL: Boolean(env("BETTER_AUTH_URL") ?? env("NEXT_PUBLIC_APP_URL")),
  };
  const providers = Object.entries(PROVIDER_KEYS).map(([id, keys]) => {
    const missing = keys.filter((k) => !envAny(k));
    const generic = id === "oidc" || id === "infomaniak" || id === "proton";
    return {
      id,
      configured: missing.length === 0,
      missing,
      callbackUrl: `${base}/api/auth/${generic ? "oauth2/callback" : "callback"}/${id}`,
    };
  });
  return { baseUrl: base, secretDerived: resolved?.derived ?? false, core, coreReady: Object.values(core).every(Boolean), providers };
}
