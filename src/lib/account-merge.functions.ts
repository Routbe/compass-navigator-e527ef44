import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireAuth } from "@/lib/auth/middleware";

/** Step A — the kept account (signed in) gets a one-time pin + QR, valid 5 minutes. */
export const startAccountMerge = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { createMergeTicket } = await import("./account-merge.server");
    const ticket = await createMergeTicket(context.userId);
    return { ok: true as const, pin: ticket.pin, qrPayload: `rout-merge:${ticket.token}`, expiresAt: ticket.expiresAt };
  });

type CodeInput = { pin?: string; token?: string };
const codeOf = (input: CodeInput) => {
  const token = input?.token?.replace(/^rout-merge:/, "").trim() || null;
  const pin = input?.pin?.trim() || null;
  if (!pin && !token) throw new Error("code_required");
  return { pin, token };
};

/** Step B — the second account previews both accounts; a code is e-mailed. */
export const previewAccountMerge = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: CodeInput) => codeOf(input))
  .handler(async ({ data, context }) => {
    const { previewMerge } = await import("./account-merge.server");
    return previewMerge({ secondaryUserId: context.userId, ...data, request: getRequest() });
  });

/** Step C — e-mail code + choices; everything moves to the kept account. */
export const redeemAccountMerge = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: CodeInput & { code: string; keepHandle: string; keepDesign: string }) => {
    const side = (v: string) => (v === "secondary" ? "secondary" : "primary") as "primary" | "secondary";
    return { ...codeOf(input), code: String(input.code ?? "").slice(0, 12), keepHandle: side(input.keepHandle), keepDesign: side(input.keepDesign) };
  })
  .handler(async ({ data, context }) => {
    const { redeemMergeTicket } = await import("./account-merge.server");
    return redeemMergeTicket({ secondaryUserId: context.userId, ...data });
  });
