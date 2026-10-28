import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmWorkspaceConversionCode,
  getConversionPreflight,
  startWorkspaceConversion,
} from "@/lib/workspace-conversion.functions";

const ERRORS: Record<string, string> = {
  same_account: "De eigenaar moet een ander, persoonlijk account zijn.",
  unknown_user: "Geen account gevonden met dit ID.",
  bad_code: "De code klopt niet of is verlopen.",
  rate_limited: "Te veel aanvragen. Probeer het later opnieuw.",
  no_email: "Dit account heeft geen e-mailadres voor de code.",
  no_transfer: "Er loopt geen omzetting meer. Begin opnieuw.",
};

/** Settings: turn this account into a Workspace owned by a human account. */
export function ConvertToWorkspaceWizard() {
  const qc = useQueryClient();
  const preflightFn = useServerFn(getConversionPreflight);
  const startFn = useServerFn(startWorkspaceConversion);
  const confirmFn = useServerFn(confirmWorkspaceConversionCode);
  const { data, isLoading } = useQuery({ queryKey: ["workspace-conversion"], queryFn: () => preflightFn() });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["workspace-conversion"] });

  const s = data?.summary;
  const pending = data?.open;

  async function start() {
    setBusy(true);
    try {
      const r = await startFn({ data: { workspaceName: name, target } });
      if (!r.ok) return void toast.error(ERRORS[r.reason] ?? "Dat lukte niet.");
      toast.success(`Code verstuurd naar ${r.sentTo}.${r.ownerExists ? "" : " De eigenaar krijgt een uitnodiging om een account te maken."}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const r = await confirmFn({ data: { code } });
      if (!r.ok) return void toast.error(ERRORS[r.reason] ?? "Dat lukte niet.");
      toast.success(r.completed ? "Omgezet naar een Workspace." : "Bevestigd. Nu wachten op de eigenaar.");
      if (r.completed) window.location.reload();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-medium">Zet dit account om naar een Workspace</h2>
          <p className="text-sm text-muted-foreground">
            Voor accounts die eigenlijk een bedrijf zijn. Bedrijven loggen niet zelf in: een persoon wordt eigenaar.
          </p>
        </div>
      </div>

      {isLoading || !s ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : pending ? (
        <div className="space-y-3">
          <p className="text-sm">
            Omzetting naar <strong>{pending.workspaceName}</strong>, eigenaar <strong>{pending.targetEmail}</strong>.
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>{pending.otpVerified ? "✓" : "○"} Bevestigd met e-mailcode</li>
            <li>{pending.accepted ? "✓" : "○"} Eigenaar heeft geaccepteerd</li>
          </ul>
          {!pending.otpVerified && (
            <div className="flex gap-2">
              <Input inputMode="numeric" maxLength={6} placeholder="6-cijferige code" value={code} onChange={(e) => setCode(e.target.value)} />
              <Button onClick={confirm} disabled={busy || code.length !== 6}>Bevestig</Button>
            </div>
          )}
        </div>
      ) : !open ? (
        <Button variant="outline" onClick={() => setOpen(true)}>Bekijk wat er meegaat</Button>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ["Links", s.links],
              ["QR-codes", s.qrCodes],
              ["Domeinen", s.domains],
              ["Apps & API-sleutels", s.apps],
              ["Badges", s.badges],
              ["Actieve facturatie", s.activeBilling ? "Ja" : "Nee"],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-medium">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Je profiel, statistieken en domeinen gaan mee. {s.hasBlueBadge && "De blauwe verificatiebadge vervalt: die is alleen voor personen. "}
            Facturatie loopt gewoon door. Je huidige login werkt nog 30 dagen alleen als doorverwijzing.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Naam van de Workspace" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <Input placeholder="E-mail of ID van de eigenaar" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <Button onClick={start} disabled={busy || !name.trim() || target.trim().length < 3}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Stuur bevestigingscode
          </Button>
        </div>
      )}
    </section>
  );
}
