import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Signed /go app links: the QR generator asks the server to sign the
 * destinations, and /go only auto-redirects when the signature matches.
 * Unsigned or tampered links show a confirmation page instead.
 */
const target = z.string().trim().max(2048).optional();
const goSchema = z.object({ i: target, a: target, w: target });

function canonical(d: z.infer<typeof goSchema>): string {
  return `i=${d.i ?? ""}\na=${d.a ?? ""}\nw=${d.w ?? ""}`;
}

async function hmac(payload: string): Promise<string> {
  const { signValueRaw } = await import("./go-link.server");
  return signValueRaw(payload);
}

function isWebUrl(value?: string): boolean {
  if (!value) return true;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export const signGoLink = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => goSchema.parse(data))
  .handler(async ({ data }) => {
    if (![data.i, data.a, data.w].every(isWebUrl)) return { sig: null };
    return { sig: await hmac(canonical(data)) };
  });

export const verifyGoLink = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => goSchema.extend({ s: z.string().max(200).optional() }).parse(data))
  .handler(async ({ data }) => {
    if (!data.s || ![data.i, data.a, data.w].every(isWebUrl)) return { valid: false };
    const expected = await hmac(canonical(data));
    return { valid: expected === data.s };
  });
