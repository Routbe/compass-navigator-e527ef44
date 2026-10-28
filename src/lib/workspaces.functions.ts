import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";
import { WORKSPACE_ROLES, checkMemberChange, canManageTeam, canAssignRole, slugify, type WorkspaceRole } from "./workspace-rules";

const roleSchema = z.enum(WORKSPACE_ROLES);
const uuid = z.string().uuid();

export type WorkspaceSummary = { id: string; name: string; slug: string; avatarUrl: string | null; plan: string; role: WorkspaceRole };

/** Personal context + every workspace the caller belongs to, and which one is active. */
export const getWorkspaceContext = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { sql } = await import("@/lib/neon");
    const { resolveActiveWorkspace } = await import("./workspaces.server");
    // Pending invites are accepted only for a verified email address, matched server-side.
    const email = context.claims.email_verified ? String(context.claims.email ?? "").toLowerCase() : "";
    if (email) {
      await sql.transaction([
        sql`insert into public.workspace_members (workspace_id, user_id, role)
            select workspace_id, ${context.userId}, role from public.workspace_invites
            where status = 'pending' and lower(email) = ${email}
            on conflict do nothing`,
        sql`update public.workspace_invites set status = 'accepted' where status = 'pending' and lower(email) = ${email}`,
      ]);
    }
    const rows = (await sql`
      select w.id, w.name, w.slug, w.avatar_url, w.plan, m.role::text as role
      from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
      where m.user_id = ${context.userId} order by w.name limit 100
    `) as { id: string; name: string; slug: string; avatar_url: string | null; plan: string; role: WorkspaceRole }[];
    const active = await resolveActiveWorkspace(context.userId);
    return {
      workspaces: rows.map((r): WorkspaceSummary => ({ id: r.id, name: r.name, slug: r.slug, avatarUrl: r.avatar_url, plan: r.plan, role: r.role })),
      activeWorkspaceId: active.workspaceId,
      activeRole: active.role,
    };
  });

export const setActiveWorkspace = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ workspaceId: uuid.nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { getWorkspaceRole, setActiveWorkspaceCookie } = await import("./workspaces.server");
    if (data.workspaceId && !(await getWorkspaceRole(context.userId, data.workspaceId))) throw new Error("Forbidden");
    await setActiveWorkspaceCookie(data.workspaceId);
    return { ok: true as const };
  });

export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    const { sql } = await import("@/lib/neon");
    const { setActiveWorkspaceCookie } = await import("./workspaces.server");
    let base = slugify(data.name);
    if (base.length < 2) base = "team";
    const slug = `${base.slice(0, 32)}-${Math.random().toString(36).slice(2, 6)}`;
    const [res] = (await sql.transaction([
      sql`insert into public.workspaces (name, slug) values (${data.name}, ${slug})`,
      sql`insert into public.workspace_members (workspace_id, user_id, role)
          select id, ${context.userId}, 'owner' from public.workspaces where slug = ${slug}`,
      sql`select id from public.workspaces where slug = ${slug}`,
    ])).slice(2) as { id: string }[][];
    const id = res?.[0]?.id;
    if (!id) throw new Error("Workspace kon niet worden aangemaakt.");
    await setActiveWorkspaceCookie(id);
    return { id };
  });

export const listWorkspaceTeam = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ workspaceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { sql } = await import("@/lib/neon");
    const { assertWorkspaceRole } = await import("./workspaces.server");
    const myRole = await assertWorkspaceRole(context.userId, data.workspaceId, ["owner", "admin"]);
    const members = (await sql`
      select m.user_id, m.role::text as role, m.created_at, u.email, p.username
      from public.workspace_members m
      left join public.users u on u.id = m.user_id
      left join public.profiles p on p.id = m.user_id
      where m.workspace_id = ${data.workspaceId}
      order by case m.role when 'owner' then 0 when 'admin' then 1 when 'developer' then 2 else 3 end, m.created_at
      limit 200
    `) as { user_id: string; role: WorkspaceRole; created_at: string; email: string | null; username: string | null }[];
    const invites = (await sql`
      select id, email, role::text as role, created_at from public.workspace_invites
      where workspace_id = ${data.workspaceId} and status = 'pending' order by created_at desc limit 100
    `) as { id: string; email: string; role: WorkspaceRole; created_at: string }[];
    return {
      myRole,
      me: context.userId,
      members: members.map((m) => ({ userId: m.user_id, role: m.role, email: m.email, username: m.username, joinedAt: String(m.created_at) })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: String(i.created_at) })),
    };
  });

export const changeMemberRole = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ workspaceId: uuid, userId: uuid, role: roleSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { sql } = await import("@/lib/neon");
    const { assertWorkspaceRole, getWorkspaceRole, countOwners } = await import("./workspaces.server");
    const actor = await assertWorkspaceRole(context.userId, data.workspaceId, ["owner", "admin"]);
    const target = await getWorkspaceRole(data.userId, data.workspaceId);
    if (!target) throw new Error("Dit lid bestaat niet meer.");
    const err = checkMemberChange(actor, { kind: "role", targetRole: target, nextRole: data.role }, await countOwners(data.workspaceId));
    if (err) throw new Error(err);
    await sql`update public.workspace_members set role = ${data.role}::public.workspace_role
              where workspace_id = ${data.workspaceId} and user_id = ${data.userId}`;
    return { ok: true as const };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ workspaceId: uuid, userId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { sql } = await import("@/lib/neon");
    const { assertWorkspaceRole, getWorkspaceRole, countOwners } = await import("./workspaces.server");
    const actor = await assertWorkspaceRole(context.userId, data.workspaceId, ["owner", "admin"]);
    const target = await getWorkspaceRole(data.userId, data.workspaceId);
    if (!target) return { ok: true as const };
    const err = checkMemberChange(actor, { kind: "remove", targetRole: target }, await countOwners(data.workspaceId));
    if (err) throw new Error(err);
    await sql`delete from public.workspace_members where workspace_id = ${data.workspaceId} and user_id = ${data.userId}`;
    return { ok: true as const };
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ workspaceId: uuid, email: z.string().trim().toLowerCase().email().max(254), role: roleSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { sql } = await import("@/lib/neon");
    const { assertWorkspaceRole } = await import("./workspaces.server");
    const actor = await assertWorkspaceRole(context.userId, data.workspaceId, ["owner", "admin"]);
    if (!canManageTeam(actor) || !canAssignRole(actor, data.role)) throw new Error("Alleen een eigenaar kan iemand eigenaar maken.");
    const already = (await sql`
      select 1 from public.workspace_members m join public.users u on u.id = m.user_id
      where m.workspace_id = ${data.workspaceId} and lower(u.email) = ${data.email} limit 1
    `) as unknown[];
    if (already.length) throw new Error("Deze persoon is al lid.");
    await sql`
      insert into public.workspace_invites (workspace_id, email, role, invited_by)
      values (${data.workspaceId}, ${data.email}, ${data.role}::public.workspace_role, ${context.userId})
      on conflict (workspace_id, lower(email)) where status = 'pending'
      do update set role = excluded.role, invited_by = excluded.invited_by
    `;
    return { ok: true as const };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ workspaceId: uuid, inviteId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { sql } = await import("@/lib/neon");
    const { assertWorkspaceRole } = await import("./workspaces.server");
    await assertWorkspaceRole(context.userId, data.workspaceId, ["owner", "admin"]);
    await sql`update public.workspace_invites set status = 'revoked'
              where id = ${data.inviteId} and workspace_id = ${data.workspaceId} and status = 'pending'`;
    return { ok: true as const };
  });
