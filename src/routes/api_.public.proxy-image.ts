import { createFileRoute } from "@tanstack/react-router";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Privacy proxy: visitors load third-party images through ROUT, so their IP
 * and cookies never reach the image host. Allowlisted hosts only.
 */
export const Route = createFileRoute("/api_/public/proxy-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { guardRequest } = await import("@/lib/api-guard.server");
        const limited = guardRequest(request, "proxy-image", 300, 60000);
        if (limited) return limited;
        const { isAllowedProxyUrl } = await import("@/lib/image-proxy-rules");
        const region = process.env.SCALEWAY_REGION || process.env.S3_REGION || "fr-par";
        const bucket = process.env.SCALEWAY_CLIENT_BUCKET || process.env.SCALEWAY_DEFAULT_BUCKET || process.env.S3_BUCKET_NAME;
        const storageHosts = bucket ? [`${bucket}.s3.${region}.scw.cloud`] : [];
        const target = isAllowedProxyUrl(new URL(request.url).searchParams.get("url") ?? "", storageHosts);
        if (!target) return new Response("Not allowed", { status: 400 });
        try {
          const res = await fetch(target.toString(), {
            redirect: "error",
            headers: { accept: "image/*", "user-agent": "rout.be image proxy" },
            signal: AbortSignal.timeout(8000),
          });
          const type = res.headers.get("content-type") ?? "";
          if (!res.ok || !/^image\/(png|jpeg|webp|gif|avif)/.test(type)) return new Response("Bad upstream", { status: 502 });
          const len = Number(res.headers.get("content-length") ?? 0);
          if (len > MAX_BYTES) return new Response("Too large", { status: 413 });
          const buf = await res.arrayBuffer();
          if (buf.byteLength > MAX_BYTES) return new Response("Too large", { status: 413 });
          return new Response(buf, {
            headers: {
              "content-type": type,
              "cache-control": "public, max-age=86400, s-maxage=86400, immutable",
              "x-content-type-options": "nosniff",
              "content-security-policy": "default-src 'none'",
              "referrer-policy": "no-referrer",
            },
          });
        } catch {
          return new Response("Upstream failed", { status: 502 });
        }
      },
    },
  },
});
