import { describe, expect, it } from "vitest";
import { translateBioSchema } from "./bio-validation";
describe("bio translation input", () => {
  it("accepts exactly 1000 characters", () => {
    expect(translateBioSchema.safeParse({ text: "a".repeat(1000) }).success).toBe(true);
  });
  it("rejects more than 1000 characters, even whitespace padding", () => {
    expect(translateBioSchema.safeParse({ text: "a".repeat(1001) }).success).toBe(false);
    expect(translateBioSchema.safeParse({ text: " ".repeat(1000) + "a" }).success).toBe(false);
  });
  it("rejects empty input and invalid locales", () => {
    expect(translateBioSchema.safeParse({ text: "  " }).success).toBe(false);
    expect(translateBioSchema.safeParse({ text: "Hello", sourceLocale: "es" }).success).toBe(false);
  });
});
