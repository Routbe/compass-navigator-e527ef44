/** Pure fixed-window rate-limit rules (shared by server code and tests). */
export type RateRule = { limit: number; windowSec: number };

export const RATE_RULES = {
  oauthToken: { limit: 30, windowSec: 60 },
  authAttempt: { limit: 10, windowSec: 60 },
  smsSendUser: { limit: 5, windowSec: 3600 },
  smsSendPhone: { limit: 3, windowSec: 3600 },
  smsSendIp: { limit: 10, windowSec: 3600 },
  smsVerify: { limit: 10, windowSec: 600 },
  appCreate: { limit: 5, windowSec: 3600 },
} satisfies Record<string, RateRule>;

export function windowStartMs(nowMs: number, windowSec: number): number {
  const size = windowSec * 1000;
  return Math.floor(nowMs / size) * size;
}

/** `hits` = count after this request was added. */
export function decideRateLimit(hits: number, rule: RateRule, nowMs: number): { ok: boolean; retryAfter: number } {
  if (hits <= rule.limit) return { ok: true, retryAfter: 0 };
  const end = windowStartMs(nowMs, rule.windowSec) + rule.windowSec * 1000;
  return { ok: false, retryAfter: Math.max(1, Math.ceil((end - nowMs) / 1000)) };
}

export function tooManyRequests(retryAfter: number, extra: Record<string, string> = {}): Response {
  return Response.json(
    { error: "rate_limited", code: "rate_limited", message: "Te veel pogingen. Probeer het later opnieuw." },
    { status: 429, headers: { ...extra, "retry-after": String(retryAfter), "cache-control": "no-store" } },
  );
}
