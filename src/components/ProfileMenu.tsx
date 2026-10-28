import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  LayoutDashboard,
  LogOut,
  Settings,
  ChevronDown,
  Sparkles,
  PanelsTopLeft,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useRouterState } from "@tanstack/react-router";
import { Link, useNavigate } from "@/lib/router-compat";
import { useAuth } from "@/hooks/useAuth";
import { clearAdminRoleCache } from "@/hooks/useIsAdmin";
import { UserAvatar } from "@/components/UserAvatar";
import { useWorkspaceContext } from "@/components/WorkspaceSwitcher";
import { canUseDeveloperTools } from "@/lib/workspace-rules";
import { getMyAccount } from "@/lib/account.functions";

/**
 * Account context only. Platform tools live in the burger menu so the two
 * surfaces never duplicate each other.
 */
export function ProfileMenu() {
  const { data: wsCtx } = useWorkspaceContext();
  const devTools = canUseDeveloperTools(wsCtx?.activeRole ?? null);
  const { user, signOut, loading } = useAuth();

  const nav = useNavigate();
  const [fullName, setFullName] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [tier, setTier] = useState<string>("free");
  const [verified, setVerified] = useState(false);
  const [earlyBeliever, setEarlyBeliever] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const loadAccount = useServerFn(getMyAccount);

  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setFullName(null);
      setUsername(null);
      setTier("free");
      setVerified(false);
      setEarlyBeliever(false);
      setAvatarUrl(null);
      return;
    }
    (async () => {
      const data = await loadAccount();
      if (cancelled || !data) return;
      setFullName(data.displayName ?? null);
      setUsername(data.username ?? null);
      setTier(data.tier ?? "free");
      setVerified(Boolean(data.verified));
      setEarlyBeliever(Boolean(data.isEarlyBeliever || data.isPaid));
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const fromProvider = meta["avatar_url"] ?? meta["picture"];
      setAvatarUrl(data.avatarUrl ?? (typeof fromProvider === "string" ? fromProvider : null));
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loadAccount]);

  // Until INITIAL_SESSION resolved we must not claim "logged out" — that flicker
  // is exactly what an OAuth return looks like right before the hash is read.
  if (loading) {
    return (
      <div
        aria-label="Checking your session"
        aria-busy="true"
        className="flex h-9 items-center gap-2 rounded-xl border border-border pl-1 pr-2"
      >
        <span className="h-7 w-7 animate-pulse rounded-lg bg-muted" />
        <span className="hidden h-3 w-20 animate-pulse rounded bg-muted sm:inline-block" />
      </div>
    );
  }

  if (!user) {
    // On the auth portal itself the header CTAs are redundant noise.
    if (pathname.startsWith("/auth") || pathname.startsWith("/login")) return null;
    return (
      <Button asChild size="sm">
        <Link to="/auth/sign-in">Sign in</Link>
      </Button>
    );
  }

  const name = fullName || user.user_metadata?.full_name || user.email?.split("@")[0] || "Account";
  const displayName = String(name).charAt(0).toUpperCase() + String(name).slice(1);
  const handle = username || user.email?.split("@")[0] || "you";
  const tierLabel = earlyBeliever ? "Early Believer" : verified || tier === "pro" ? "Pro" : "Free";
  const isPaidTier = tierLabel !== "Free";

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-border pl-1 pr-2 transition-colors hover:bg-secondary"
          >
            <UserAvatar
              src={avatarUrl}
              name={fullName || username || user.email || "Account"}
              className="h-7 w-7"
              textClassName="text-[11px]"
              rounded="rounded-lg"
            />
            <span className="hidden max-w-[9rem] truncate text-sm sm:inline">{displayName}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-72 bg-card">
          <div className="px-2 py-2">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <span
                className={
                  "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase " +
                  (isPaidTier ? "bg-foreground text-background" : "bg-muted text-muted-foreground")
                }
              >
                {tierLabel}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => nav("/studio")} className="gap-2">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden /> Profile Hub Studio
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => nav("/dashboard")} className="gap-2">
            <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden /> Dashboard
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => nav("/settings")} className="gap-2">
            <Settings className="h-4 w-4 shrink-0" aria-hidden /> Account &amp; Security
          </DropdownMenuItem>
          {devTools && (
            <DropdownMenuItem asChild>
              <a href="/console" target="_blank" rel="noopener noreferrer" className="gap-2">
                <PanelsTopLeft className="h-4 w-4 shrink-0" aria-hidden /> Developer Console
              </a>
            </DropdownMenuItem>
          )}



          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-red-600"
            onClick={async () => {
              clearAdminRoleCache();
              await signOut();
              nav("/", { replace: true });
            }}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden /> Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
