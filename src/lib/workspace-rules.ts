/** Pure workspace/RBAC rules — shared by server checks and UI, unit-tested. */

export const WORKSPACE_ROLES = ["owner", "admin", "developer", "editor"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Eigenaar",
  admin: "Admin",
  developer: "Developer",
  editor: "Editor",
};

export function isWorkspaceRole(v: unknown): v is WorkspaceRole {
  return typeof v === "string" && (WORKSPACE_ROLES as readonly string[]).includes(v);
}

/** Developer Console and API Keys & Webhooks. Personal context (null) = full access to own apps. */
export function canUseDeveloperTools(role: WorkspaceRole | null): boolean {
  return role === null || role === "owner" || role === "admin" || role === "developer";
}

/** Team tab: view and manage members. */
export function canManageTeam(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin";
}

/** Only owners may hand out or take away the owner role. */
export function canAssignRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (!canManageTeam(actor)) return false;
  return target !== "owner" || actor === "owner";
}

export type MemberChange =
  | { kind: "remove"; targetRole: WorkspaceRole }
  | { kind: "role"; targetRole: WorkspaceRole; nextRole: WorkspaceRole };

/**
 * Decides whether a member change is allowed. Returns an error message or null.
 * A workspace always keeps at least one owner.
 */
export function checkMemberChange(actor: WorkspaceRole, change: MemberChange, ownerCount: number): string | null {
  if (!canManageTeam(actor)) return "Alleen eigenaars en admins beheren het team.";
  if (change.targetRole === "owner" && actor !== "owner") return "Alleen een eigenaar kan een eigenaar wijzigen.";
  if (change.kind === "role" && !canAssignRole(actor, change.nextRole)) return "Alleen een eigenaar kan iemand eigenaar maken.";
  const losesOwner = change.targetRole === "owner" && (change.kind === "remove" || change.nextRole !== "owner");
  if (losesOwner && ownerCount <= 1) return "Een workspace heeft altijd minstens één eigenaar.";
  return null;
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39);
}
