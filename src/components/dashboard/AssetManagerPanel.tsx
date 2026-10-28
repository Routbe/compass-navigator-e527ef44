import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Download, FileText, ImageIcon, Loader2, Music, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteMyAsset, getMyAssetUrl, listMyAssets, uploadMyAsset } from "@/lib/assets.functions";
import { LIFETIME_MAX_BYTES, LIFETIME_MAX_FILES } from "@/lib/asset-retention";

const mb = (b: number) => `${Math.round(b / 1024 / 1024)} MB`;

function TypeIcon({ type }: { type: string }) {
  if (type.startsWith("image/")) return <ImageIcon className="h-5 w-5" aria-hidden />;
  if (type.startsWith("audio/")) return <Music className="h-5 w-5" aria-hidden />;
  return <FileText className="h-5 w-5" aria-hidden />;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Dashboard-tab "Bestanden & Media": quotum, retentiestatus en acties per bestand. */
export function AssetManagerPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listMyAssets);
  const upload = useServerFn(uploadMyAsset);
  const getUrl = useServerFn(getMyAssetUrl);
  const remove = useServerFn(deleteMyAsset);
  const input = useRef<HTMLInputElement>(null);
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["my-assets"], queryFn: () => list(), retry: false });

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await upload({ data: { fileName: file.name, base64: await toBase64(file), days: Number(days) } });
      toast.success("Bestand geüpload");
      await qc.invalidateQueries({ queryKey: ["my-assets"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function withUrl(id: string, action: (url: string) => void) {
    try {
      action((await getUrl({ data: { id } })).url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Link ophalen mislukt");
    }
  }

  async function onDelete(id: string) {
    try {
      await remove({ data: { id } });
      toast.success("Bestand verwijderd");
      await qc.invalidateQueries({ queryKey: ["my-assets"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  if (q.isLoading)
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Bestanden konden niet geladen worden. Probeer het later opnieuw.
      </p>
    );

  const { used, assets, lifetime } = q.data;

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-3.5 sm:p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">Opslag</span>
          <span className="text-xs text-muted-foreground">
            {used.files} / {LIFETIME_MAX_FILES} bestanden gebruikt · {mb(used.bytes)} / {mb(LIFETIME_MAX_BYTES)}
          </span>
        </div>
        <Progress value={Math.min(100, (used.bytes / LIFETIME_MAX_BYTES) * 100)} />
        <p className="text-xs text-muted-foreground">
          {lifetime
            ? "Je account bewaart bestanden permanent."
            : "Gratis accounts bewaren bestanden tijdelijk (standaard 7 dagen, maximaal 90). Verified/Pro bewaart permanent."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,audio/mpeg"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Uploaden
        </Button>
        {!lifetime && (
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="h-9 w-40" aria-label="Bewaartermijn">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[7, 14, 30, 60, 90].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Bewaar {d} dagen
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {assets.length === 0 ? (
        <p className="rounded-xl bg-muted/40 p-6 text-center text-xs text-muted-foreground">
          Nog geen bestanden geüpload.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {assets.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <TypeIcon type={a.contentType} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.fileName}</p>
                <p className="text-xs text-muted-foreground">{Math.max(1, Math.round(a.fileSize / 1024))} KB</p>
              </div>
              {a.isLifetime ? (
                <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">Permanent (PRO)</span>
              ) : a.isExpired || a.daysRemaining === 0 ? (
                <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 text-[11px] text-destructive-foreground">Verloopt vandaag</span>
              ) : (
                <span className="shrink-0 rounded-full bg-warning px-2 py-0.5 text-[11px] text-warning-foreground">
                  Verloopt over {a.daysRemaining} {a.daysRemaining === 1 ? "dag" : "dagen"}
                </span>
              )}
              <div className="flex shrink-0 gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label="URL kopiëren"
                  onClick={() =>
                    withUrl(a.id, (url) => {
                      void navigator.clipboard.writeText(url);
                      toast.success("Tijdelijke link gekopieerd (1 uur geldig)");
                    })
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label="Downloaden"
                  onClick={() => withUrl(a.id, (url) => window.open(url, "_blank", "noopener"))}
                >
                  <Download className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Verwijderen" onClick={() => onDelete(a.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
