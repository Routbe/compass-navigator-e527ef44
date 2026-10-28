import { describe, expect, it } from "vitest";
import { isPrivilegeError, runSchemaEnsure } from "@/lib/db/schema-ensure.server";

describe("runtime DDL under least-privilege role", () => {
  it("skips a permission error (SQLSTATE 42501) from rout_app", async () => {
    await expect(
      runSchemaEnsure(async () => {
        throw Object.assign(new Error("permission denied for schema public"), { code: "42501" });
      }, "t1"),
    ).resolves.toBeUndefined();
  });

  it("skips 'must be owner' on ALTER TABLE", () => {
    expect(isPrivilegeError(new Error("must be owner of table profiles"))).toBe(true);
  });

  it("still throws real errors", async () => {
    await expect(
      runSchemaEnsure(async () => {
        throw Object.assign(new Error("syntax error"), { code: "42601" });
      }, "t2"),
    ).rejects.toThrow("syntax error");
  });
});
