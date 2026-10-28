// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import { buildMode, routeIgnorePattern } from "./src/lib/app-mode-routes";

// Hard split: each Vercel project builds only its own routes (VITE_APP_MODE=public | admin).
const ignoreRoutes = routeIgnorePattern(buildMode(process.env));

// Op Vercel: zet NITRO_PRESET=vercel zodat de server als Vercel-functie gebouwd wordt.
const nitroPreset = process.env["NITRO_PRESET"] || (process.env["VERCEL"] ? "vercel" : undefined);

export default defineConfig({
  ...(nitroPreset ? { nitro: { preset: nitroPreset } } : {}),
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    ...(ignoreRoutes ? { router: { routeFileIgnorePattern: ignoreRoutes } } : {}),
  },
  vite: {
    // Browser-only vendor splitting (the server bundle is left alone): stable,
    // separately cached chunks keep the app chunk small.
    environments: {
      client: {
        build: {
          rollupOptions: {
            output: {
              manualChunks(id: string) {
                if (!id.includes("node_modules")) return undefined;
                if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
                if (id.includes("@tanstack")) return "vendor-tanstack";
                if (id.includes("@radix-ui")) return "vendor-radix";
                if (/recharts|d3-/.test(id)) return "vendor-charts";
                if (/shiki|streamdown|mermaid|katex/.test(id)) return "vendor-markdown";
                if (/qr-code-styling|qrcode/.test(id)) return "vendor-qr";
                return undefined;
              },
            },
          },
        },
      },
    },
    plugins: [
      // Offline app shell. The worker is generated (never hand-written) and is
      // registered only from src/lib/pwa.ts, which refuses dev and preview.
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        devOptions: { enabled: false },
        manifest: false,
        workbox: {
          globPatterns: ["**/*.{js,css,woff2,png,svg,ico}"],
          // The studio bundle is several MB; the default 2 MB precache limit fails the build.
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          navigateFallback: "/",
          navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//, /^\/_serverFn\//],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // HTML navigations always try the network first so a deploy is
              // picked up immediately; the cache is only the offline fallback.
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: { cacheName: "rout-pages", networkTimeoutSeconds: 5 },
            },
            {
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin &&
                (request.destination === "script" ||
                  request.destination === "style" ||
                  request.destination === "font"),
              handler: "CacheFirst",
              options: {
                cacheName: "rout-assets",
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
  },
});
