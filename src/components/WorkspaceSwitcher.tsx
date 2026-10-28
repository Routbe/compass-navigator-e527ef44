import { useI18n } from "@/lib/i18n";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronsUpDown, Plus, User, Users } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { createWorkspace, getWorkspaceContext, setActiveWorkspace } from "@/lib/workspaces.functions";

export const WORKSPACE_QUERY_KEY = ["workspace-context"] as const;

export function useWorkspaceContext() {
  const fetchCtx = useServerFn(getWorkspaceContext);
  return useQuery({ queryKey: WORKSPACE_QUERY_KEY, queryFn: () => fetchCtx(), staleTime: 30_000, retry: false });
}

/** Vercel-style switcher: Personal + every workspace the user belongs to. */
export function WorkspaceSwitcher({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useWorkspaceContext();
  const setActive = useServerFn(setActiveWorkspace);
  const create = useServerFn(createWorkspace);
  const [busy, setBusy] = useState(false);

  const active = data?.workspaces.find((w) => w.id === data.activeWorkspaceId) ?? null;

  const switchTo = async (workspaceId: string | null) => {
    setBusy(true);
    try {
      await setActive({ data: { workspaceId } });
      await qc.invalidateQueries();
    } catch {
      toast.error(t("workspace.switchError"));
    } finally {
      setBusy(false);
    }
  };

  const newWorkspace = async () => {
    const name = window.prompt(t("workspace.namePrompt"));
    if (!name?.trim()) return;
    setBusy(true);
    try {
      await create({ data: { name: name.trim() } });
      await qc.invalidateQueries();
      toast.success(t("workspace.created"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("workspace.createError"));
    } finally {
      setBusy(false);
    }
  };

  if (!alwaysShow && !data?.workspaces.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-tour="workspace"
        disabled={busy}
        className="flex max-w-[12rem] items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-muted"
        aria-label={t("workspace.switch")}
      >
        {active ? <Users className="h-4 w-4 shrink-0" /> : <User className="h-4 w-4 shrink-0" />}
        <span className="truncate">{active ? active.name : t("workspace.personal")}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onClick={() => switchTo(null)}>
          <User className="mr-2 h-4 w-4" /> {t("workspace.personal")}
          {!active && <Check className="ml-auto h-4 w-4" />}
        </DropdownMenuItem>
        {data && data.workspaces.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("workspace.list")}</DropdownMenuLabel>
            {data.workspaces.map((w) => (
              <DropdownMenuItem key={w.id} onClick={() => switchTo(w.id)}>
                <Users className="mr-2 h-4 w-4" />
                <span className="truncate">{w.name}</span>
                <span className="ml-auto pl-2 text-xs text-muted-foreground">{t(`workspace.role.${w.role}`)}</span>
                {w.id === active?.id && <Check className="ml-1 h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={newWorkspace}>
          <Plus className="mr-2 h-4 w-4" /> {t("workspace.new")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
