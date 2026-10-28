import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./auth/middleware";
import { translateBioSchema, saveBioSchema } from "./bio-validation";

export const translateBio = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => translateBioSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { hitRateLimit } = await import("./rate-limit-db.server");
    const limit = await hitRateLimit("bio-translation", context.userId, { limit: 10, windowSec: 3600 });
    if (!limit.ok) throw new Error("Translation limit reached. Please try again in an hour.");
    const { generateBioTranslations } = await import("./bio-gateway.server");
    const descriptions = await generateBioTranslations(data.text, data.sourceLocale);
    const { sql } = await import("./neon");
    if (data.variant === "alias") {
      await sql`update public.alias_profiles set profile_descriptions = ${JSON.stringify(descriptions)}::jsonb where user_id = ${context.userId}`;
    } else {
      await sql`update public.profiles set profile_descriptions = ${JSON.stringify(descriptions)}::jsonb where id = ${context.userId}`;
    }
    return descriptions;
  });

export const saveBioTranslations = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => saveBioSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { sql } = await import("./neon");
    const bio = data.descriptions[data.sourceLocale];
    if (data.variant === "alias") {
      await sql`update public.alias_profiles set profile_descriptions = ${JSON.stringify(data.descriptions)}::jsonb,
        bio = case when ${data.confirmSourceBio} then ${bio} else bio end where user_id = ${context.userId}`;
    } else {
      await sql`update public.profiles set profile_descriptions = ${JSON.stringify(data.descriptions)}::jsonb,
        bio = case when ${data.confirmSourceBio} then ${bio} else bio end where id = ${context.userId}`;
    }
    return { ok: true };
  });
