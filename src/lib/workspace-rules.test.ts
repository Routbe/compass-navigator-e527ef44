import { describe, expect, it } from "vitest";
import { canManageTeam, canUseDeveloperTools, checkMemberChange, slugify } from "./workspace-rules";

describe("workspace rules", () => {
  it("editors cannot open the developer console; owner/admin/developer can", () => {
    expect(canUseDeveloperTools("editor")).toBe(false);
    expect(canUseDeveloperTools("developer")).toBe(true);
    expect(canUseDeveloperTools("admin")).toBe(true);
    expect(canUseDeveloperTools("owner")).toBe(true);
  });

  it("only owners and admins manage the team", () => {
    expect(canManageTeam("developer")).toBe(false);
    expect(canManageTeam("editor")).toBe(false);
    expect(canManageTeam("admin")).toBe(true);
  });

  it("the last owner cannot be removed or demoted", () => {
    expect(checkMemberChange("owner", { kind: "remove", targetRole: "owner" }, 1)).not.toBeNull();
    expect(checkMemberChange("owner", { kind: "role", targetRole: "owner", nextRole: "admin" }, 1)).not.toBeNull();
    expect(checkMemberChange("owner", { kind: "remove", targetRole: "owner" }, 2)).toBeNull();
  });

  it("an admin cannot promote someone to owner", () => {
    expect(checkMemberChange("admin", { kind: "role", targetRole: "editor", nextRole: "owner" }, 1)).not.toBeNull();
    expect(checkMemberChange("admin", { kind: "role", targetRole: "editor", nextRole: "developer" }, 1)).toBeNull();
  });

  it("slugify makes url-safe names", () => {
    expect(slugify("Café Één BV")).toBe("cafe-een-bv");
  });
});
