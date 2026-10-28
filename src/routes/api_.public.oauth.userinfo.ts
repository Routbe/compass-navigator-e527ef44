import { createFileRoute } from "@tanstack/react-router";

/**
 * Userinfo-endpoint: geeft de claims terug die bij de scopes van het
 * access-token horen. `sub` blijft altijd het interne ROUT-gebruikers-id.
 */
export const Route = createFileRoute("/api_/public/oauth/userinfo")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "authorization, content-type",
          },
        }),
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const headers = {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  };
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return Response.json(
      { error: "invalid_token", error_description: "Bearer-token ontbreekt." },
      { status: 401, headers },
    );
  }
  try {
    const { verifyAccessToken, identityClaims, getClientByClientId } = await import("@/lib/oauth/provider.server");
    const { sub, scopes, clientId } = await verifyAccessToken(auth.slice(7).trim());
    const client = clientId ? await getClientByClientId(clientId) : null;
    const claims = await identityClaims(sub, scopes, { handleSync: Boolean(client?.handleSyncEnabled) });
    return Response.json({ sub, ...claims }, { headers });
  } catch (error) {
    const known = error as { message?: string };
    return Response.json(
      { error: "invalid_token", error_description: known.message ?? "Token is ongeldig." },
      { status: 401, headers },
    );
  }
}
