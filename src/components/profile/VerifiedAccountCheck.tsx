import { BadgeCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";

/** Groen vinkje bij een gekoppeld account: opent dezelfde uitleg-popover als de identiteitsbadge. */
export function VerifiedAccountCheck({
  platform,
  handle,
  name,
  className = "h-3.5 w-3.5",
  theme,
}: {
  platform: string;
  handle?: string | null;
  /** Naam van het geverifieerde lid, zoals bij het blauwe vinkje. */
  name?: string | null;
  className?: string;
  theme?: { card: string; border: string; text: string; muted: string };
}) {
  const { t } = useI18n();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("profile.verifiedAccount")}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="inline-flex items-center text-emerald-500 transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <BadgeCheck className={className} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-72 rounded-xl border p-4 text-left"
        style={theme ? { background: theme.card, borderColor: theme.border, color: theme.text } : undefined}
      >
        <div className="flex items-start gap-2">
          <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-tight">{t("profile.verified_badge_title")}</p>
            {name && <p className="text-sm font-medium">{name}</p>}
            <p className="text-xs font-medium" style={theme ? { color: theme.muted } : undefined}>
              {platform}{handle ? ` · @${handle.replace(/^@/, "")}` : ""}
            </p>
            <p className="text-xs leading-relaxed" style={theme ? { color: theme.muted } : undefined}>
              {t("profile.verified_badge_body")}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
