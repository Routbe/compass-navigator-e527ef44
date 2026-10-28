import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeMemberRole, inviteMember, listWorkspaceTeam, removeMember, revokeInvite } from "@/lib/workspaces.functions";
import { ROLE_LABELS, WORKSPACE_ROLES, canAssignRole, type WorkspaceRole } from "@/lib/workspace-rules";

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export function TeamTab({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listWorkspaceTeam);
  const setRole = useServerFn(changeMemberRole);
  const remove = useServerFn(removeMember);
  const invite = useServerFn(inviteMember);
  const revoke = useServerFn(revokeInvite);
  const key = ["workspace-team", workspaceId];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => list({ data: { workspaceId } }), retry: false });
  const [email, setEmail] = useState("");
  const [role, setInviteRole] = useState<WorkspaceRole>("editor");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dat lukte niet.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Team laden…</p>;
  if (error || !data) return <p className="text-sm text-muted-foreground">Alleen eigenaars en admins kunnen het team van {workspaceName} beheren.</p>;

  const assignable = WORKSPACE_ROLES.filter((r) => canAssignRole(data.myRole, r));

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border p-4">
        <h3 className="font-medium">Leden van {workspaceName}</h3>
        <ul className="mt-3 divide-y divide-border">
          {data.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{m.username ? `@${m.username}` : m.email ?? "Onbekend"}{m.userId === data.me && " (jij)"}</p>
                {m.email && m.username && <p className="truncate text-xs text-muted-foreground">{m.email}</p>}
              </div>
              <select
                aria-label="Rol"
                className={selectClass}
                value={m.role}
                disabled={busy || (m.role === "owner" && data.myRole !== "owner")}
                onChange={(e) => run(() => setRole({ data: { workspaceId, userId: m.userId, role: e.target.value as WorkspaceRole } }), "Rol aangepast.")}
              >
                {WORKSPACE_ROLES.filter((r) => r === m.role || assignable.includes(r)).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
              <Button
                variant="ghost" size="icon" aria-label="Lid verwijderen" disabled={busy}
                onClick={() => { if (window.confirm("Dit lid verwijderen uit de workspace?")) void run(() => remove({ data: { workspaceId, userId: m.userId } }), "Lid verwijderd."); }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border p-4">
        <h3 className="font-medium">Lid uitnodigen</h3>
        <p className="mt-1 text-xs text-muted-foreground">De persoon wordt lid zodra die inlogt met dit (bevestigde) e-mailadres.</p>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => { e.preventDefault(); void run(async () => { await invite({ data: { workspaceId, email, role } }); setEmail(""); }, "Uitnodiging klaargezet."); }}
        >
          <Input type="email" required placeholder="naam@bedrijf.be" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-[14rem] flex-1" />
          <select aria-label="Rol" className={selectClass} value={role} onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}>
            {assignable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <Button type="submit" disabled={busy}>Uitnodigen</Button>
        </form>
        {data.invites.length > 0 && (
          <ul className="mt-4 divide-y divide-border">
            {data.invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1 truncate">{i.email}</span>
                <span className="text-xs text-muted-foreground">{ROLE_LABELS[i.role]} · wacht</span>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => revoke({ data: { workspaceId, inviteId: i.id } }), "Uitnodiging ingetrokken.")}>Intrekken</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
