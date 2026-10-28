import { z } from "zod";
export const bioLocaleSchema = z.enum(["nl", "en", "fr", "de"]);
export const bioDescriptionsSchema = z.strictObject({
  nl: z.string().max(1000), en: z.string().max(1000),
  fr: z.string().max(1000), de: z.string().max(1000),
});
export type BioDescriptions = z.infer<typeof bioDescriptionsSchema>;
export const translateBioSchema = z.strictObject({
  text: z.string().max(1000).refine((v) => v.trim().length > 0, "Bio is required"),
  sourceLocale: bioLocaleSchema.optional(),
  variant: z.enum(["verified", "alias"]).default("verified"),
});
export const saveBioSchema = z.strictObject({
  descriptions: bioDescriptionsSchema,
  sourceLocale: bioLocaleSchema,
  confirmSourceBio: z.boolean().default(false),
  variant: z.enum(["verified", "alias"]).default("verified"),
});
