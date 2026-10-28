import { createFileRoute } from "@tanstack/react-router";

/** Booking engine worker: sync ICS/CalDAV, release stale holds, recompute availability. LOVABLE_CRON_SECRET. */
async function handle(request: Request) {
  const secret = process.env["LOVABLE_CRON_SECRET"];
  if (!secret) return new Response("Not configured", { status: 503 });
  const provided =
    request.headers.get("x-cron-secret") ?? (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (provided !== secret) return new Response("Unauthorized", { status: 401 });

  const { syncDueCalendars, runDueJobs } = await import("@/lib/booking-engine/recompute.server");
  const { releaseExpiredHolds } = await import("@/lib/booking-engine/book.server");
  const sync = await syncDueCalendars().catch((e: unknown) => ({ error: e instanceof Error ? e.message : "error" }));
  const released = await releaseExpiredHolds();
  const jobs = await runDueJobs();
  return Response.json({ success: true, sync, released, jobs });
}

export const Route = createFileRoute("/api_/public/cron/booking-engine")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});
