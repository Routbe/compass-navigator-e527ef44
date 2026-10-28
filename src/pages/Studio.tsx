import { useTranslation } from "react-i18next";
import { BrandLoader } from "@/components/BrandLoader";
import { FirstUseTour } from "@/components/onboarding/FirstUseTour";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProfileEditor, type ProfileVariant } from "@/components/dashboard/ProfileEditor";
import { BadgeCheck, Lock, Sparkles, HeartHandshake, ChevronDown, Check } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/hooks/useAuth";
import { getVerificationState } from "@/lib/verification.functions";
import { verifiedTabUnlocked } from "@/lib/studio-access";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { VerificationPanel } from "@/components/dashboard/VerificationPanel";

/** /studio — the dedicated Profile Hub (link-in-bio) workspace. */
export default function Studio() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  // Privacy Alias is the default; the verified profile is a premium tab.
  const [variant, setVariant] = useState<ProfileVariant>("alias");
  const [pageMode, setPageMode] = useState<"profile" | "tip">("profile");
  const [pages, setPages] = useState({ tipEnabled: false, handle: "" });
  const updatePages = useCallback((next: { tipEnabled: boolean; handle: string }) => setPages(next), []);
  const fetchState = useServerFn(getVerificationState);
  const state = useQuery({
    queryKey: ["verification-state", user?.id],
    queryFn: () => fetchState(),
    enabled: Boolean(user),
    retry: false,
  });
  const unlocked = verifiedTabUnlocked(state.data);

  useEffect(() => {
    if (!loading && !user) nav("/auth/sign-in", { replace: true });
  }, [user, loading, nav]);

  const tabs = [
    { id: "alias" as ProfileVariant, label: t("studio.profile.alias"), hint: "rout.be/u/handle", Icon: Sparkles, locked: false },
    { id: "verified" as ProfileVariant, label: t("studio.profile.verified"), hint: "rout.be/handle", Icon: BadgeCheck, locked: !unlocked },
  ];

  return (
    <AppLayout
      width="wide"
      title={t("studio.page.title")}
      description={t("studio.page.description")}
      crumbs={[{ label: "Studio" }]}
      trustBadges
    >
      {loading || !user ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="relative h-24 w-24">
            <BrandLoader label={t("studio.studio.loading")} />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col space-y-6 pb-8">
          <FirstUseTour area="studio" userId={user.id} />
          <div data-tour="studio-pages" className="flex flex-wrap gap-2 bg-transparent p-1">
            {tabs.map(({ id, label, hint, Icon, locked }) => {
              const selected = variant === id;
              const select = () => { setVariant(id); setPageMode("profile"); };
              const trigger = <Button variant="ghost" type="button" aria-pressed={selected} onClick={select} className={`h-auto min-h-12 min-w-0 flex-1 justify-start gap-2 whitespace-normal rounded-lg px-3 py-2 text-left shadow-none ${selected ? "bg-foreground text-background hover:bg-foreground hover:text-background" : "bg-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}>
                {selected && pageMode === "tip" ? <HeartHandshake className="size-4 shrink-0" /> : <Icon className="size-4 shrink-0" />}
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{selected && pageMode === "tip" ? t("studio.mode.tip") : label}</span><span className="block break-all font-mono text-xs opacity-70">{selected && pages.handle ? `rout.be/${id === "alias" ? "u/" : ""}${pages.handle}${pageMode === "tip" ? "/tip" : ""}` : hint}</span></span>
                {locked && <Lock className="size-3.5 shrink-0" aria-label={t("studio.common.locked")} />}
              </Button>;
              if (!selected || id !== "verified" || (!pages.tipEnabled && pageMode !== "tip")) return <div key={id} className="flex min-w-0 flex-1">{trigger}</div>;
              return <DropdownMenu key={id}><DropdownMenuTrigger asChild><Button variant="ghost" aria-label={t("studio.mode.pages")} className="h-auto min-h-12 min-w-0 flex-1 justify-start gap-2 whitespace-normal rounded-lg bg-foreground px-3 py-2 text-left text-background hover:bg-foreground hover:text-background">
                {pageMode === "tip" ? <HeartHandshake className="size-4 shrink-0" /> : <Icon className="size-4 shrink-0" />}<span className="min-w-0 flex-1"><span className="block text-sm font-medium">{pageMode === "tip" ? t("studio.mode.tip") : label}</span><span className="block break-all font-mono text-xs opacity-70">rout.be/{pages.handle}{pageMode === "tip" ? "/tip" : ""}</span></span><ChevronDown className="size-4 shrink-0" />
              </Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-24px)]">
                {(["profile", "tip"] as const).filter(mode => mode === "profile" || pages.tipEnabled).map(mode => <DropdownMenuItem key={mode} onSelect={() => setPageMode(mode)}>{mode === "profile" ? <BadgeCheck className="size-4" /> : <HeartHandshake className="size-4" />}<span className="flex-1">{t(`studio.mode.${mode}`)}</span>{pageMode === mode && <Check className="size-4" />}</DropdownMenuItem>)}
              </DropdownMenuContent></DropdownMenu>;
            })}
          </div>
          <ErrorBoundary label={t("studio.page.title")} inline>
            {variant === "verified" && !unlocked ? (
              state.isLoading ? (
                <p className="text-sm text-muted-foreground">{t("studio.common.loading")}</p>
              ) : (
                <LockedVerifiedTab />
              )
            ) : (
              <ProfileEditor key={variant} variant={variant} pageMode={pageMode} onPagesChange={updatePages} />
            )}
          </ErrorBoundary>
        </div>
      )}
    </AppLayout>
  );
}

function LockedVerifiedTab() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 py-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted">
          <Lock className="h-5 w-5" aria-hidden />
        </div>
        <h2 className="font-display text-2xl tracking-tight">{t("studio.profile.verified")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {t("studio.profile.unlock")}
        </p>
      </div>
      <VerificationPanel />
    </div>
  );
}
