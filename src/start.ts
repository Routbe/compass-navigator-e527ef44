import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { isStrictPath, securityHeaders, sessionCookieProblems } from "./lib/security-headers";
import { appMode, modeDecision } from "./lib/app-mode";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

/**
 * Security headers on every response (rules in lib/security-headers.ts).
 *
 * Framing is limited with CSP frame-ancestors (rout.be + the Lovable editor)
 * instead of X-Frame-Options, which cannot allow the editor. CORS is only ever
 * allowed on the public OIDC endpoints; anything else loses the header.
 * Session cookies without HttpOnly/Secure/SameSite are reported in the log.
 */
const securityHeadersMiddleware = createMiddleware().server(async ({ request, next }) => {
  const result = await next();
  const response = (result as { response?: Response }).response;
  const headers = response?.headers;
  if (headers) {
    const url = new URL(request.url);
    const https = url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
    for (const [k, v] of Object.entries(securityHeaders(https, url.pathname))) {
      if (!headers.has(k)) headers.set(k, v);
    }
    // Public pages must never carry cross-origin isolation (Opera ERR_BLOCKED_BY_RESPONSE).
    if (!isStrictPath(url.pathname)) headers.delete("cross-origin-embedder-policy");
    // Server functions are same-origin only; never let them answer cross-origin.
    if (url.pathname.startsWith("/_serverFn")) headers.delete("access-control-allow-origin");
    if (https) {
      for (const cookie of headers.getSetCookie?.() ?? []) {
        const problems = sessionCookieProblems(cookie);
        if (problems.length) console.warn(`[security] session cookie missing ${problems.join(", ")}`);
      }
    }
  }
  return result;
});

/**
 * Split-brain gate (lib/app-mode.ts): public mode 404s every admin surface,
 * admin mode serves only the portal, and admin responses are never indexed.
 */
const appModeMiddleware = createMiddleware().server(async ({ request, next }) => {
  const mode = appMode();
  if (mode === "all") return next();
  const { pathname } = new URL(request.url);
  const noindex = { "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" };
  if (mode === "admin" && pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain", ...noindex } });
  }
  const d = modeDecision(mode, pathname);
  if (d.kind === "notFound") return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  if (d.kind === "redirect") return new Response(null, { status: 302, headers: { location: d.to, ...noindex } });
  const result = await next();
  if (mode === "admin") (result as { response?: Response }).response?.headers.set("x-robots-tag", "noindex, nofollow");
  return result;
});

// Sessions are carried by the httpOnly `rout_session` cookie (Neon), so no
// client-side token attacher is needed on server functions.
export const startInstance = createStart(() => ({
  functionMiddleware: [],
  requestMiddleware: [errorMiddleware, appModeMiddleware, securityHeadersMiddleware, csrfMiddleware],
}));
