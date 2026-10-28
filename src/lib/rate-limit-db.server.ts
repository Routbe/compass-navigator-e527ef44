import { sql } from "@/lib/neon";
import { runSchemaEnsure } from "@/lib/db/schema-ensure.server";
import { decideRateLimit, windowStartMs, type RateRule } from "@/lib/rate-limit-rules";

/**
 * Database-backed limits (db/64) so every server instance shares one counter.
 * A database failure lets the request through with a warning: a broken
 * counter must never lock everybody out of sign-in.
 */
let ready: Promise<void> | null = null;
function ensure() {
  ready ??= runSchemaEnsure(async () => {
    await sql`create table if not exists public.rate_limits (
      bucket text not null, window_start timestamptz not null, hits int not null default 0,
      primary key (bucket, window_start))`;
  }, "rate-limits");
  return ready;
}

export async function sha256Hex(value: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hitRateLimit(name: string, subject: string, rule: RateRule) {
  const now = Date.now();
  try {
    await ensure();
    const bucket = `${name}:${await sha256Hex(subject)}`;
    const start = new Date(windowStartMs(now, rule.windowSec)).toISOString();
    const rows = (await sql`insert into public.rate_limits (bucket, window_start, hits)
      values (${bucket}, ${start}, 1)
      on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
      returning hits`) as { hits: number }[];
    if (Math.random() < 0.01) {
      void sql`delete from public.rate_limits where window_start < now() - interval '1 day'`.catch(() => {});
    }
    return decideRateLimit(Number(rows[0]?.hits ?? 1), rule, now);
  } catch (error) {
    console.warn(`[rate-limit] ${name} skipped:`, (error as Error)?.message);
    return { ok: true, retryAfter: 0 };
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
