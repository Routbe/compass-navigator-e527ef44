import { describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = {
      validate: (input: unknown): unknown => input,
      middleware: () => chain,
      inputValidator: (validate: (input: unknown) => unknown) => { chain.validate = validate; return chain; },
      handler: () => chain,
    };
    return chain;
  },
}));
vi.mock("@/lib/auth/middleware", () => ({ requireAuth: {} }));
import { saveStudioProfile } from "@/lib/studio-profile.functions";
import { saveAliasProfile } from "@/lib/alias-profile.functions";

const avatar = "/api/public/avatar?path=12345678-1234-1234-1234-123456789abc%2Favatar-1729770000.webp";
describe("upload URL accepted by both profile save paths", () => {
  for (const [space, save] of [["verified", saveStudioProfile], ["alias", saveAliasProfile]] as const) {
    const validate = (save as unknown as { validate: (input: unknown) => { avatarUrl: string } }).validate;
    it(`${space} saves the exact first-party URL returned by avatar upload`, () => {
      expect(validate({ username: "anna", avatarUrl: avatar }).avatarUrl).toBe(avatar);
    });
    it(`${space} rejects arbitrary or malformed relative paths`, () => {
      for (const url of ["//evil.example/avatar", "/api/public/avatar?path=../../secret", `${avatar}&extra=1`, "/admin/avatar"]) {
        expect(() => validate({ username: "anna", avatarUrl: url })).toThrow();
      }
    });
    it(`${space} retains HTTPS storage upload support`, () => {
      const url = "https://member.s3.fr-par.scw.cloud/users/12345678-1234-1234-1234-123456789abc/avatar/photo.webp";
      expect(validate({ username: "anna", avatarUrl: url }).avatarUrl).toBe(url);
    });
  }
});