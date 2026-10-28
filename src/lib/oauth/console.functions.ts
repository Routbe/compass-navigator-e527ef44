import { requireDeveloperAccess } from "@/lib/auth/developer-access";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cleanRedirectUri } from "./redirect-match";
import { optionalAuth, requireAuth } from "@/lib/auth/middleware";
import { needsStepUp, shareRichIdentity, STRICT_ACR } from "./step-up";
import { clientSchema, settingsSchema, testUserSchema, verificationRequestSchema } from "./console-schemas";

/**
 * Server functions for the ROUT Developer Console and the consent screen.
 *
 * Console (developer role): every function checks the session + verified
 * developer status itself and only touches the caller's own apps. Client
 * secrets leave the server once: on create or rotate.
 *
 * Consent screen (consumer role): separate from the console; uses only the
 * end user's normal ROUT session.
 */

async function assertVerified(userId: string) {
  const { isVerifiedDeveloper } = await import("./provider.server");
  if (!(await isVerifiedDeveloper(userId))) {
    throw new Error("De Developer Console is beschikbaar voor geverifieerde leden.");
  }
}

/** Turns provider OAuthErrors into plain messages for the console UI. */
async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const { OAuthError } = await import("./provider.server");
    if (error instanceof OAuthError) throw new Error(error.message);
    throw error;
  }
}

const idSchema = z.object({ id: z.string().uuid() }).strict();

export const consoleAccess = createServerFn({ method: "GET" })
  .middleware([requireDeveloperAccess])
  .handler(async ({ context }) => {
    const { isVerifiedDeveloper } = await import("./provider.server");
    return { verified: await isVerifiedDeveloper(context.userId) };
  });

export const listOAuthDebugEvents = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), errorsOnly: z.boolean().optional() }).strict().parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertVerified(context.userId);
    const { listClients } = await import("./provider.server");
    const app = (await listClients(context.userId)).find((c) => c.id === data.id);
    if (!app) throw new Error("Deze app bestaat niet (meer).");
    const { listDebugEvents } = await import("./debug-events.server");
    return listDebugEvents(app.clientId, Boolean(data.errorsOnly));
  });

export const listMyApiActivity = createServerFn({ method: "GET" })
  .middleware([requireDeveloperAccess])
  .handler(async ({ context }) => {
    await assertVerified(context.userId);
    const { listClients } = await import("./provider.server");
    const apps = await listClients(context.userId);
    const { listDebugEventsForClients } = await import("./debug-events.server");
    const names = new Map(apps.map((a) => [a.clientId, a.name]));
    const events = await listDebugEventsForClients(apps.map((a) => a.clientId));
    return events.map((e) => ({ ...e, appName: names.get(e.clientId) ?? e.clientId }));
  });

export const listOAuthClients = createServerFn({ method: "GET" })
  .middleware([requireDeveloperAccess])
  .handler(async ({ context }) => {
    await assertVerified(context.userId);
    const { listClients } = await import("./provider.server");
    return listClients(context.userId);
  });

export const saveOAuthClient = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) => clientSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertVerified(context.userId);
    const { createClient, updateClient } = await import("./provider.server");
    const input = {
      name: data.name,
      description: data.description ?? null,
      logoUrl: data.logoUrl ?? null,
      homepageUrl: data.homepageUrl ?? null,
      privacyUrl: data.privacyUrl ?? null,
      termsUrl: data.termsUrl ?? null,
      redirectUris: data.redirectUris,
      scopes: data.scopes,
      ...(data.flowPreference ? { flowPreference: data.flowPreference } : {}),
      ...(data.richIdentityEnabled !== undefined ? { richIdentityEnabled: data.richIdentityEnabled } : {}),
      ...(data.handleSyncEnabled !== undefined ? { handleSyncEnabled: data.handleSyncEnabled } : {}),
    };
    return friendly(async () => {
      if (data.id) {
        return { client: await updateClient(context.userId, data.id, input), clientSecret: null };
      }
      const { hitRateLimit } = await import("@/lib/rate-limit-db.server");
      const { RATE_RULES } = await import("@/lib/rate-limit-rules");
      const limit = await hitRateLimit("app-create", context.userId, RATE_RULES.appCreate);
      if (!limit.ok) throw new Error("Je hebt het maximum aantal nieuwe apps per uur bereikt. Probeer later opnieuw.");
      const created = await createClient(context.userId, input);
      const { later, recipient, sendSiteMail, siteOrigin } = await import("@/lib/site-mail.server");
      later(async () => {
        const r = await recipient(context.userId);
        const { appCreatedMail } = await import("@/emails/site-mails");
        await sendSiteMail(r.email, appCreatedMail({ lang: r.lang, name: r.name, app: created.client.name, clientId: created.client.clientId, consoleUrl: `${siteOrigin()}/developers` }), ["console", "app-created"]);
      });
      return created;
    });
  });

export const saveOAuthClientSettings = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) => settingsSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertVerified(context.userId);
    const { updateClientSettings } = await import("./provider.server");
    const { id, ...rest } = data;
    const settings = {
      ...rest,
      ...(rest.supportEmail !== undefined ? { supportEmail: rest.supportEmail?.toLowerCase() || null } : {}),
      ...(rest.dpoEmail !== undefined ? { dpoEmail: rest.dpoEmail?.toLowerCase() || null } : {}),
      ...(rest.legalOwner !== undefined ? { legalOwner: rest.legalOwner || null } : {}),
    };
    return friendly(() => updateClientSettings(context.userId, id, settings));
  });

export const deleteOAuthClient = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertVerified(context.userId);
    const { deleteClient } = await import("./provider.server");
    await deleteClient(context.userId, data.id);
    return { ok: true };
  });

export const rotateOAuthSecret = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertVerified(context.userId);
    const { rotateClientSecret } = await import("./provider.server");
    return friendly(async () => {
      const clientSecret = await rotateClientSecret(context.userId, data.id);
      const { later, recipient, sendSiteMail, siteOrigin } = await import("@/lib/site-mail.server");
      later(async () => {
        const { sql } = await import("@/lib/neon");
        const rows = (await sql`select name from public.oauth_clients where id = ${data.id} limit 1`) as Record<string, unknown>[];
        const r = await recipient(context.userId);
        const { secretRotatedMail } = await import("@/emails/site-mails");
        await sendSiteMail(r.email, secretRotatedMail({ lang: r.lang, name: r.name, app: String(rows[0]?.["name"] ?? "je app"), consoleUrl: `${siteOrigin()}/developers` }), ["console", "secret-rotated"]);
      });
      return { clientSecret };
    });
  });

export const getOAuthClientInsights = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertVerified(context.userId);
    const { clientInsights, latestVerification } = await import("./provider.server");
    return friendly(async () => ({
      ...(await clientInsights(context.userId, data.id)),
      verification: await latestVerification(context.userId, data.id),
    }));
  });

export const listOAuthTestUsers = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertVerified(context.userId);
    const { listTestUsers } = await import("./provider.server");
    return friendly(() => listTestUsers(context.userId, data.id));
  });

export const addOAuthTestUser = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) => testUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertVerified(context.userId);
    const { addTestUser } = await import("./provider.server");
    await friendly(() => addTestUser(context.userId, data.id, data.identifier));
    return { ok: true };
  });

export const removeOAuthTestUser = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) => testUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertVerified(context.userId);
    const { removeTestUser } = await import("./provider.server");
    await friendly(() => removeTestUser(context.userId, data.id, data.identifier));
    return { ok: true };
  });

export const requestOAuthVerification = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) => verificationRequestSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertVerified(context.userId);
    const { requestVerification } = await import("./provider.server");
    await friendly(() => requestVerification(context.userId, data.id, data.note ?? ""));
    const { later, sendSiteMail, siteOrigin } = await import("@/lib/site-mail.server");
    later(async () => {
      const { sql } = await import("@/lib/neon");
      const rows = (await sql`select name, client_id from public.oauth_clients where id = ${data.id} limit 1`) as Record<string, unknown>[];
      const app = String(rows[0]?.["name"] ?? "onbekende app");
      const clientId = String(rows[0]?.["client_id"] ?? "");
      const adminEmail = process.env["ADMIN_EMAIL"] ?? process.env["BREVO_ADMIN_EMAIL"] ?? null;
      const { verificationRequestedMail } = await import("@/emails/site-mails");
      const { mailLang } = await import("@/emails/verification-mails");
      await sendSiteMail(adminEmail, verificationRequestedMail({ lang: mailLang("nl"), app, clientId, note: data.note ?? "", reviewUrl: `${siteOrigin()}/admin` }), ["console", "verification-requested"]);
    });
    return { ok: true };
  });

/* ------------------------------------------------------ admin review ---- */

export const listAppVerificationRequests = createServerFn({ method: "GET" })
  .middleware([requireDeveloperAccess])
  .handler(async ({ context }) => {
    const { assertAdminRole } = await import("@/lib/admin.server");
    await assertAdminRole(context.userId);
    const { listPendingVerifications } = await import("./provider.server");
    return listPendingVerifications();
  });

export const reviewAppVerificationRequest = createServerFn({ method: "POST" })
  .middleware([requireDeveloperAccess])
  .inputValidator((data: unknown) =>
    z.object({ requestId: z.string().uuid(), approve: z.boolean() }).strict().parse(data),
  )
  .handler(async ({ data, context }) => {
    const { assertAdminRole } = await import("@/lib/admin.server");
    await assertAdminRole(context.userId);
    const { reviewVerification } = await import("./provider.server");
    await reviewVerification(context.userId, data.requestId, data.approve);
    const { later, recipient, sendSiteMail, siteOrigin } = await import("@/lib/site-mail.server");
    later(async () => {
      const { sql } = await import("@/lib/neon");
      const rows = (await sql`select c.name, c.owner_user_id from public.oauth_client_verification_requests v
        join public.oauth_clients c on c.client_id = v.client_id where v.id = ${data.requestId} limit 1`) as Record<string, unknown>[];
      const owner = rows[0]?.["owner_user_id"];
      if (typeof owner !== "string") return;
      const r = await recipient(owner);
      const { appReviewMail } = await import("@/emails/site-mails");
      await sendSiteMail(r.email, appReviewMail({ lang: r.lang, name: r.name, app: String(rows[0]?.["name"] ?? "je app"), approved: data.approve, consoleUrl: `${siteOrigin()}/developers` }), ["console", "app-review"]);
    });
    return { ok: true };
  });

/* ------------------------------------------------------ consent screen --- */

const authorizeSchema = z.object({
  clientId: z.string().min(4).max(120),
  // Keycloak/brokers sturen lange, soms dubbel-geëncodeerde URI's: opschonen vóór alles.
  redirectUri: z.string().min(4).max(2000).transform((v) => cleanRedirectUri(v)),
  scope: z.string().max(200).optional(),
  state: z.string().max(300).nullable().optional(),
  nonce: z.string().max(300).nullable().optional(),
  /** Empty = no PKCE (only allowed when the app turned PKCE off). */
  codeChallenge: z.string().max(200),
  codeChallengeMethod: z.string().max(10),
  prompt: z.string().max(60).nullable().optional(),
  maxAge: z.string().max(12).nullable().optional(),
  acrValues: z.string().max(200).nullable().optional(),
  loginHint: z.string().max(200).nullable().optional(),
});
type AuthorizeInput = z.infer<typeof authorizeSchema>;

export type AuthorizeDebug = { code: string; expected: string[]; received: string };

export type AuthorizePrompt = {
  ok: boolean;
  error?: string;
  /** Developer-facing details, shown behind a toggle on the error screen. */
  debug?: AuthorizeDebug;
  /** Standard OIDC error redirect back to the app (only when the redirect URI is trusted). */
  redirectTo?: string;
  app?: {
    name: string;
    logoUrl: string | null;
    homepageUrl: string | null;
    privacyUrl: string | null;
    termsUrl: string | null;
    verified?: boolean;
  };
  scopes?: string[];
  account?: { email: string; name: string | null; handle: string | null; avatarUrl: string | null };
  /** Sign-in providers linked to this ROUT account (Google, Apple, …) — names only. */
  linkedProviders?: string[];
  alreadyGranted?: boolean;
  /** Strict flow / prompt=login / max_age / acr_values → extra code required. */
  requiresStepUp?: boolean;
  /** App asks (optionally) for public activity. */
  richIdentity?: boolean;
};

async function profileOf(userId: string) {
  const { sql } = await import("@/lib/neon");
  try {
    const rows = (await sql`select username, avatar_url from public.profiles
      where user_id = ${userId} or id = ${userId} limit 1`) as Record<string, unknown>[];
    return {
      handle: (rows[0]?.["username"] as string | null) ?? null,
      avatarUrl: (rows[0]?.["avatar_url"] as string | null) ?? null,
    };
  } catch {
    return { handle: null, avatarUrl: null };
  }
}

/**
 * Shared checks for every authorize step. Fails safe: with an unknown app or
 * wrong redirect URI we never send the user back to the app.
 */
async function checkRequest(data: AuthorizeInput) {
  const { getClientByClientId, redirectAllowed, SUPPORTED_SCOPES } = await import("./provider.server");
  const { logOAuthEvent } = await import("./debug-events.server");
  const requested = (data.scope ?? "openid").split(" ").filter(Boolean);
  const detail = {
    redirectUri: data.redirectUri,
    scopes: requested,
    hasPkce: data.codeChallenge.length > 0,
    pkceMethod: data.codeChallengeMethod ?? null,
  };
  const fail = (code: string, error: string, back?: string, debug?: AuthorizeDebug) => {
    logOAuthEvent(data.clientId, "authorize", "error", code, detail);
    return {
      error,
      ...(back ? { redirectTo: errorRedirect(data.redirectUri, data.state, back, error) } : {}),
      ...(debug ? { debug } : {}),
    } as const;
  };
  const client = await getClientByClientId(data.clientId);
  if (!client || client.status !== "active") return fail("invalid_client", "Deze app is onbekend bij ROUT.");
  if (!redirectAllowed(client, data.redirectUri)) {
    return fail("invalid_redirect_uri", "Het terugkeeradres van deze app klopt niet.");
  }

  const hasPkce = data.codeChallenge.length > 0;
  if (hasPkce && (data.codeChallengeMethod !== "S256" || data.codeChallenge.length < 43)) {
    return fail("invalid_pkce_method", "Deze app moet PKCE met S256 gebruiken.", "invalid_request");
  }
  if (!hasPkce && (client.requirePkce || !client.hasSecret)) {
    return fail("missing_code_challenge", "Deze app moet PKCE (S256) meesturen.", "invalid_request");
  }
  const scopes = requested.filter(
    (s) => client.scopes.includes(s) && SUPPORTED_SCOPES.includes(s as never),
  );
  if (!scopes.includes("openid")) scopes.unshift("openid");
  const unknown = requested.find((s) => !scopes.includes(s));
  if (unknown) return fail("invalid_scope", `Deze app vraagt een recht dat niet mag: ${unknown}.`, "invalid_scope");
  const stepUp = needsStepUp({
    flowPreference: client.flowPreference,
    prompt: data.prompt ?? null,
    maxAge: data.maxAge ?? null,
    acrValues: data.acrValues ?? null,
  });
  logOAuthEvent(data.clientId, "authorize", "success", null, detail);
  return { client, scopes, stepUp } as const;
}

import { redirectWith, errorRedirect } from "./authorize-redirect";

export const describeAuthorizeRequest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => authorizeSchema.parse(data))
  .handler(async ({ data, context }): Promise<AuthorizePrompt> => {
    const checked = await checkRequest(data);
    if ("error" in checked) {
      const { getOwnedRedirectMismatch } = await import("./owner-redirect.server");
      const debug = await getOwnedRedirectMismatch(context.userId, data.clientId, data.redirectUri);
      return {
        ok: false,
        ...(debug ? { debug } : {}),
        error: checked.error,
        ...("redirectTo" in checked ? { redirectTo: checked.redirectTo } : {}),
        ...("debug" in checked && checked.debug ? { debug: checked.debug } : {}),
      };
    }
    const { client, scopes, stepUp } = checked;
    const { hasConsent, userMayUseClient, isVerifiedApp } = await import("./provider.server");
    if (!(await userMayUseClient(client, { id: context.userId, email: context.user.email }))) {
      const error = "Deze app is nog in testfase. Enkel uitgenodigde testgebruikers kunnen inloggen.";
      return { ok: false, error, redirectTo: errorRedirect(data.redirectUri, data.state, "access_denied", error) };
    }
    return {
      ok: true,
      app: {
        name: client.name,
        logoUrl: client.logoUrl,
        homepageUrl: client.homepageUrl,
        privacyUrl: client.privacyUrl,
        termsUrl: client.termsUrl,
        verified: await isVerifiedApp(client.clientId),
      },
      scopes,
      account: {
        email: context.user.email,
        name: (context.user.userMetadata["full_name"] as string | null) ?? null,
        ...(await profileOf(context.userId)),
      },
      linkedProviders: await (async () => {
        const { linkedAccountsOf } = await import("./provider.server");
        const list = await linkedAccountsOf(context.userId).catch(() => []);
        return [...new Set(list.map((l) => l.provider))];
      })(),
      alreadyGranted: await hasConsent(context.userId, client.clientId, scopes),
      requiresStepUp: stepUp,
      richIdentity: client.richIdentityEnabled,
    };
  });

export const decideAuthorizeRequest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) =>
    authorizeSchema.extend({ allow: z.boolean(), richIdentityOptIn: z.boolean().optional() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ redirectTo: string } | { error: string }> => {
    const checked = await checkRequest(data);
    if ("error" in checked) return { error: checked.error ?? "Ongeldige aanvraag." };
    const { client, scopes, stepUp } = checked;
    const { issueAuthorizationCode, rememberConsent, userMayUseClient, consumeVerifiedStepUp } =
      await import("./provider.server");

    if (!data.allow) {
      return {
        redirectTo: redirectWith(data.redirectUri, data.state, {
          error: "access_denied",
          error_description: "De gebruiker gaf geen toestemming.",
        }),
      };
    }
    if (!(await userMayUseClient(client, { id: context.userId, email: context.user.email }))) {
      return {
        redirectTo: redirectWith(data.redirectUri, data.state, {
          error: "access_denied",
          error_description: "Deze app is in testfase en dit account is geen testgebruiker.",
        }),
      };
    }
    if (stepUp && !(await consumeVerifiedStepUp(context.userId, client.clientId))) {
      return { error: "Bevestig eerst de verificatiecode." };
    }

    const code = await issueAuthorizationCode({
      acr: stepUp ? STRICT_ACR : null,
      richIdentity: shareRichIdentity(client.richIdentityEnabled, Boolean(data.richIdentityOptIn)),
      clientId: client.clientId,
      userId: context.userId,
      redirectUri: data.redirectUri,
      scopes,
      codeChallenge: data.codeChallenge,
      nonce: data.nonce ?? null,
    });
    const { hasConsent: hadConsent } = await import("./provider.server");
    const firstTime = !(await hadConsent(context.userId, client.clientId, scopes).catch(() => true));
    await rememberConsent(context.userId, client.clientId, scopes);
    if (firstTime) {
      const { later, recipient, sendSiteMail, siteOrigin } = await import("@/lib/site-mail.server");
      later(async () => {
        const r = await recipient(context.userId);
        const { appConnectedMail } = await import("@/emails/site-mails");
        await sendSiteMail(r.email, appConnectedMail({ lang: r.lang, name: r.name, app: client.name, scopes, manageUrl: `${siteOrigin()}/dashboard` }), ["console", "app-connected"]);
      });
    }
    return { redirectTo: redirectWith(data.redirectUri, data.state, { code }) };
  });

/**
 * `prompt=none` — Account Auto-Discovery. Never shows a screen: either a code
 * (existing session + existing consent) or an OIDC error back to the app.
 * Works without a session, hence `optionalAuth`.
 */
export const silentAuthorize = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: unknown) => authorizeSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ redirectTo: string } | { error: string }> => {
    const checked = await checkRequest(data);
    if ("error" in checked) return { error: checked.error ?? "Ongeldige aanvraag." };
    const { client, scopes, stepUp } = checked;
    const fail = (error: string, description: string) => ({
      redirectTo: redirectWith(data.redirectUri, data.state, { error, error_description: description }),
    });

    if (!client.accountDiscoveryEnabled) {
      return fail("interaction_required", "Account Auto-Discovery staat uit voor deze app.");
    }
    if (!context.user || !context.userId) return fail("login_required", "Geen actieve ROUT-sessie.");
    const hint = data.loginHint?.trim().toLowerCase();
    if (hint) {
      const { handle } = await profileOf(context.userId);
      const matches =
        hint === context.user.email.toLowerCase() || hint.replace(/^@/, "") === handle?.toLowerCase();
      if (!matches) return fail("login_required", "De actieve sessie hoort bij een ander account.");
    }
    const { hasConsent, userMayUseClient, issueAuthorizationCode } = await import("./provider.server");
    if (!(await userMayUseClient(client, { id: context.userId, email: context.user.email }))) {
      return fail("access_denied", "Deze app is in testfase en dit account is geen testgebruiker.");
    }
    if (stepUp) return fail("interaction_required", "Deze aanvraag vereist een extra verificatiestap.");
    if (!(await hasConsent(context.userId, client.clientId, scopes))) {
      return fail("consent_required", "De gebruiker gaf deze app nog geen toestemming.");
    }
    const code = await issueAuthorizationCode({
      acr: null,
      richIdentity: false,
      clientId: client.clientId,
      userId: context.userId,
      redirectUri: data.redirectUri,
      scopes,
      codeChallenge: data.codeChallenge,
      nonce: data.nonce ?? null,
    });
    return { redirectTo: redirectWith(data.redirectUri, data.state, { code }) };
  });

/* ------------------------------------------------------------ step-up ---- */

export const sendStepUpCode = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => z.object({ clientId: z.string().min(4).max(120) }).parse(data))
  .handler(async ({ data, context }) => {
    const { getClientByClientId, createStepUpCode } = await import("./provider.server");
    const client = await getClientByClientId(data.clientId);
    if (!client || client.status !== "active") return { ok: false, error: "Deze app is onbekend bij ROUT." };
    const code = await createStepUpCode(context.userId, client.clientId);
    const { sendTransactionalEmail } = await import("@/lib/notifications.server");
    const safeName = client.name.replace(/[<>&"]/g, "");
    const sent = await sendTransactionalEmail({
      to: context.user.email,
      subject: `Je ROUT-code: ${code}`,
      html: `<p>Je verificatiecode om door te gaan naar <strong>${safeName}</strong>:</p>
             <p style="font-size:28px;letter-spacing:6px;font-family:monospace"><strong>${code}</strong></p>
             <p>Deze code is 10 minuten geldig. Vroeg je dit niet aan? Negeer dan deze e-mail.</p>`,
      tags: ["oauth-step-up"],
    });
    const [user, domain] = context.user.email.split("@");
    const masked = `${(user ?? "").slice(0, 2)}•••@${domain ?? ""}`;
    return sent ? { ok: true, sentTo: masked } : { ok: false, error: "De code kon niet verstuurd worden." };
  });

export const verifyStepUp = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) =>
    z.object({ clientId: z.string().min(4).max(120), code: z.string().regex(/^\d{6}$/) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { verifyStepUpCode } = await import("./provider.server");
    const state = await verifyStepUpCode(context.userId, data.clientId, data.code);
    const messages: Record<string, string> = {
      ok: "",
      wrong: "Die code klopt niet.",
      expired: "Deze code is verlopen. Vraag een nieuwe aan.",
      locked: "Te veel pogingen. Vraag een nieuwe code aan.",
      missing: "Vraag eerst een code aan.",
    };
    return { ok: state === "ok", error: messages[state] ?? "" };
  });

/** Explicit owner action; never accepts an owner identity from the browser. */
export const addOwnerRedirect = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => z.object({
    clientId: z.string().min(1).max(100),
    redirectUri: z.string().min(4).max(2000),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const { addOwnedRedirect } = await import("./owner-redirect.server");
    await addOwnedRedirect(context.userId, data.clientId, data.redirectUri);
    return { ok: true };
  });
