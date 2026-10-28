import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Fingerprint, Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMyIdentityStatus, startIdentityVerification } from "@/lib/identity/identity.functions";
import { DIDIT_LIMIT_MESSAGE } from "@/lib/identity/identity-rules";

const RESULT: Record<string, string> = {
  verified: "Je identiteit is geverifieerd.",
  duplicate_human: "Deze persoon heeft al een geverifieerd ROUT-account.",
  already_verified: "Je account is al geverifieerd.",
  limit_reached: DIDIT_LIMIT_MESSAGE,
  not_configured: "Deze verificatiemethode is nog niet actief.",
  expired: "De verificatie is verlopen. Probeer opnieuw.",
  invalid_name: "We konden geen geldige naam ontvangen van de provider.",
  failed: "Verificatie mislukt. Probeer opnieuw.",
  provider_error: "De verificatiedienst reageert niet. Probeer later opnieuw.",
};

export function IdentityVerification() {
  const status = useQuery({ queryKey: ["identity-status"], queryFn: useServerFn(getMyIdentityStatus) });
  const start = useServerFn(startIdentityVerification);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("identity");
    if (result && result !== "pending" && RESULT[result]) {
      toast[result === "verified" ? "success" : "error"](RESULT[result]);
    } else if (result === "pending") {
      toast.message("Je scan wordt verwerkt. Dit kan enkele minuten duren.");
    }
  }, []);

  async function go(provider: "w_identity" | "didit") {
    setBusy(provider);
    try {
      const res = await start({ data: { provider, origin: window.location.origin } });
      if (res.ok) window.location.assign(res.url);
      else toast.error(RESULT[res.reason] ?? RESULT.failed);
    } catch {
      toast.error(RESULT.failed);
    } finally {
      setBusy(null);
    }
  }

  const s = status.data;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-lg font-medium">
        <Fingerprint className="h-5 w-5" aria-hidden /> Verifieer Identiteit
      </h2>
      {status.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : s?.isVerified ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <BadgeCheck className="h-4 w-4" aria-hidden /> Geverifieerd
            {s.provider === "w_identity" ? " via W Identity" : s.provider === "didit" ? " via paspoortscan" : ""}
          </p>
          <label className="block text-xs text-muted-foreground" htmlFor="verified-real-name">
            Officiële naam
          </label>
          <Input id="verified-real-name" value={s.verifiedRealName ?? ""} readOnly disabled aria-readonly />
          <p className="text-xs text-muted-foreground">
            Deze naam komt van je identiteitsbewijs en vervangt je profielnaam. Ze kan niet gewijzigd worden.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Bewijs dat je een echt persoon bent. Eén geverifieerd account per persoon; we bewaren alleen je naam en een
            onomkeerbare code, nooit je documenten.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" onClick={() => go("w_identity")} disabled={busy !== null || !s?.wConfigured} className="gap-2">
              {busy === "w_identity" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" aria-hidden />}
              Via W Identity (Gratis & Snel)
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => go("didit")}
              disabled={busy !== null || !s?.diditConfigured || !s?.diditAvailable}
              className="gap-2"
            >
              {busy === "didit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" aria-hidden />}
              Via Paspoortscan (Didit)
            </Button>
          </div>
          {s && !s.diditAvailable && <p className="text-xs text-destructive">{DIDIT_LIMIT_MESSAGE}</p>}
          {s && (!s.wConfigured || !s.diditConfigured) && (
            <p className="text-xs text-muted-foreground">
              {!s.wConfigured && "W Identity is nog niet actief. "}
              {!s.diditConfigured && "Paspoortscan is nog niet actief."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
