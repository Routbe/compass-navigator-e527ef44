import { z } from "zod";

/** First-party avatar uploads are the only relative image address accepted. */
export function isFirstPartyAvatarUrl(value: string): boolean {
  if (!value.startsWith("/api/public/avatar?")) return false;
  try {
    const url = new URL(value, "https://rout.be");
    const entries = [...url.searchParams.entries()];
    return !url.hash && entries.length === 1 && entries[0]?.[0] === "path" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/avatar-\d+\.(jpg|png|webp|gif)$/i.test(entries[0]?.[1] ?? "");
  } catch { return false; }
}

export const optionalProfileImageUrlSchema = z.string().trim().max(2_000)
  .refine(value => !value || value.startsWith("https://") || value.startsWith("data:image/") || isFirstPartyAvatarUrl(value), "invalid_url")
  .nullable().optional();