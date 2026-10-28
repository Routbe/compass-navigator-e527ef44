import { normalizeLayersPref } from "./profile-display";
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/lib/auth/middleware";
import { z } from "zod";
import { optionalProfileImageUrlSchema } from "./profile-image-url";

/**
 * RPC-laag voor het gratis aliasprofiel (`rout.be/u/<handle>`), dat volledig
 * los van het geverifieerde rootprofiel wordt beheerd.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type AliasProfileDTO = {
  username: string | null;
  displayName: string | null;
  tagline: string | null;
  avatarUrl: string | null;
  faviconUrl: string | null;
  theme: string;
  cardStyle: string;
  blocks: Json[];
  verified: boolean;
  status: string;
  verifiedLegalName: string | null;
  displayPrefs: Record<string, Json>;
  /** Is het gekoppelde account geverifieerd? (Aliaspagina blijft de gratis ruimte.) */
  ownerVerified: boolean;
  /** Roothandle van hetzelfde account, `null` zolang er geen verificatie is. */
  rootUsername: string | null;
  aliasHandle: string | null;
  draftRevision: number;
  publishedRevision: number;
  hasUnpublishedChanges: boolean;
  draftUpdatedAt: string | null;
  publishedAt: string | null;
};

export const getAliasProfile = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { readAliasProfile, ensureFreeAliasProfile } = await import("./alias-profile.server");
    // Vangnet: elk account hoort een werkende gratis pagina te hebben.
    await ensureFreeAliasProfile(context.userId);
    const live = await readAliasProfile(context.userId);
    if (!live) return null;
    const { readOrCreateProfileDraft } = await import("./profile-drafts.server");
    const draft = await readOrCreateProfileDraft(context.userId, "alias", {
      username: live.username ?? "",
      displayName: live.displayName,
      tagline: live.tagline,
      avatarUrl: live.avatarUrl,
      faviconUrl: live.faviconUrl,
      theme: live.theme,
      cardStyle: live.cardStyle,
      blocks: live.blocks,
      displayPrefs: live.displayPrefs,
    });
    return { ...live, ...draft.payload, ...draft.meta } as AliasProfileDTO;
  });

export type SaveAliasProfileInput = {
  username: string;
  displayName?: string | null;
  tagline?: string | null;
  avatarUrl?: string | null;
  faviconUrl?: string | null;
  theme?: string | null;
  cardStyle?: string | null;
  blocks?: Json[];
  displayPrefs?: Record<string, Json> | null;
  expectedRevision?: number;
};

const jsonValueSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const jsonRecordSchema = z.record(z.string(), z.union([jsonValueSchema, z.array(jsonValueSchema).max(100)]));
const optionalUrlSchema = optionalProfileImageUrlSchema;
const saveAliasProfileSchema = z.strictObject({
  username: z.string().trim().min(1).max(60),
  displayName: z.string().trim().max(120).nullable().optional(),
  tagline: z.string().trim().max(240).nullable().optional(),
  avatarUrl: optionalUrlSchema,
  faviconUrl: optionalUrlSchema,
  theme: z.string().trim().min(1).max(40).nullable().optional(),
  cardStyle: z.string().trim().min(1).max(40).nullable().optional(),
  blocks: z.array(jsonRecordSchema).max(100).optional(),
  displayPrefs: jsonRecordSchema.nullable().optional(),
  expectedRevision: z.number().int().min(0).optional(),
});
const handleSchema = z.strictObject({ handle: z.string().trim().min(1).max(60) });
const revisionSchema = z.strictObject({ expectedRevision: z.number().int().min(1) });

function validateAliasProfile(input: unknown): SaveAliasProfileInput {
  const parsed = saveAliasProfileSchema.parse(input) as SaveAliasProfileInput;
  // Server-side normalization of the layered design (never trust the client).
  if (parsed.displayPrefs && "designLayers" in parsed.displayPrefs) {
    parsed.displayPrefs = {
      ...parsed.displayPrefs,
      designLayers: normalizeLayersPref(parsed.displayPrefs["designLayers"]),
    };
  }
  return parsed;
}

function validateHandle(input: unknown): { handle: string } {
  return handleSchema.parse(input);
}

export const saveAliasProfile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(validateAliasProfile)
  .handler(async ({ data, context }) => {
    try {
      const { saveProfileDraft } = await import("./profile-drafts.server");
      const { expectedRevision = 0, ...payload } = data;
      const meta = await saveProfileDraft(context.userId, "alias", payload, expectedRevision);
      return { ok: true as const, profile: { ...payload, ...meta }, reason: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "save_failed";
      return { ok: false as const, profile: null, reason };
    }
  });

export const publishAliasProfile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => revisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { readAliasProfile, isAliasHandleFree } = await import("./alias-profile.server");
      const { readOrCreateProfileDraft, publishProfileDraft } = await import("./profile-drafts.server");
      const live = await readAliasProfile(context.userId);
      if (!live) throw new Error("profile_not_found");
      const current = await readOrCreateProfileDraft(context.userId, "alias", {
        username: live.username ?? "", displayName: live.displayName, tagline: live.tagline,
        avatarUrl: live.avatarUrl, faviconUrl: live.faviconUrl, theme: live.theme,
        cardStyle: live.cardStyle, blocks: live.blocks, displayPrefs: live.displayPrefs,
      });
      const available = await isAliasHandleFree(String(current.payload.username ?? ""), context.userId);
      if (!available.ok) throw new Error(`handle_${available.reason}`);
      const meta = await publishProfileDraft(context.userId, "alias", data.expectedRevision);
      return { ok: true as const, meta, reason: null };
    } catch (error) {
      return { ok: false as const, meta: null, reason: error instanceof Error ? error.message : "publish_failed" };
    }
  });

export const discardAliasDraft = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => revisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { readAliasProfile } = await import("./alias-profile.server");
      const { discardProfileDraft } = await import("./profile-drafts.server");
      const live = await readAliasProfile(context.userId);
      if (!live) throw new Error("profile_not_found");
      const result = await discardProfileDraft(context.userId, "alias", {
        username: live.username ?? "", displayName: live.displayName, tagline: live.tagline,
        avatarUrl: live.avatarUrl, faviconUrl: live.faviconUrl, theme: live.theme,
        cardStyle: live.cardStyle, blocks: live.blocks, displayPrefs: live.displayPrefs,
      }, data.expectedRevision);
      return { ok: true as const, ...result, reason: null };
    } catch (error) {
      return { ok: false as const, payload: null, meta: null, reason: error instanceof Error ? error.message : "discard_failed" };
    }
  });

export const checkAliasHandle = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(validateHandle)
  .handler(async ({ data, context }) => {
    const { isAliasHandleFree } = await import("./alias-profile.server");
    return isAliasHandleFree(data.handle, context.userId);
  });

/** Publieke read voor de `/u/<handle>`-pagina's — geen auth nodig. */
export const getPublicAliasProfileByHandle = createServerFn({ method: "GET" })
  .inputValidator(validateHandle)
  .handler(async ({ data }) => {
    const { readPublicAliasProfile } = await import("./alias-profile.server");
    const row = await readPublicAliasProfile(data.handle);
    if (!row) return null;
    const { parseDisplayPrefs } = await import("./profile-display");
    const { redactPrivateProfile } = await import("./public-timeline");
    const prefs = parseDisplayPrefs((row as Record<string, unknown>)["display_prefs"]);
    return redactPrivateProfile(row as Record<string, unknown>, prefs) as Record<string, Json>;
  });
