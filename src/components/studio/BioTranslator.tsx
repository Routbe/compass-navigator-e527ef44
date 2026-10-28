import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LOCALES, LOCALE_LABELS, useI18n, type Locale } from "@/lib/i18n";
import { translateBio, saveBioTranslations } from "@/lib/bio.functions";
import type { BioDescriptions } from "@/lib/bio-validation";

export function BioTranslator({ text, variant = "verified" }: { text: string; variant?: "verified" | "alias" }) {
  const { locale, t } = useI18n();
  const translate = useServerFn(translateBio);
  const save = useServerFn(saveBioTranslations);
  const [results, setResults] = useState<BioDescriptions | null>(null);
  const [active, setActive] = useState<Locale>(locale);
  const [sourceLocale, setSourceLocale] = useState<Locale>(locale);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run(saving: boolean) {
    setBusy(true);
    try {
      if (saving && results) {
        await save({ data: { descriptions: results, sourceLocale, confirmSourceBio: confirm, variant } });
        toast.success(t("ai.bio.saved"));
      } else {
        setSourceLocale(locale);
        setResults(await translate({ data: { text, sourceLocale: locale, variant } }));
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <button type="button" disabled={busy || !text.trim()} onClick={() => void run(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">{t(busy ? "ai.bio.busy" : "ai.bio.polish")}</button>
    {results && <section aria-label={t("ai.bio.title")} className="space-y-3 rounded-xl border border-border p-3">
      <div role="tablist" aria-label={t("ai.bio.language")} className="flex gap-1">{LOCALES.map(l => <button key={l} type="button" role="tab" aria-selected={active === l} aria-controls="bio-translation-panel" id={`bio-tab-${l}`} onClick={() => setActive(l)} className={`rounded-lg px-2 py-1 text-xs ${active === l ? "bg-foreground text-background" : "hover:bg-muted"}`}>{LOCALE_LABELS[l]}</button>)}</div>
      <div role="tabpanel" id="bio-translation-panel" aria-labelledby={`bio-tab-${active}`}><textarea aria-label={LOCALE_LABELS[active]} maxLength={1000} value={results[active]} onChange={e => setResults({ ...results, [active]: e.target.value })} className="min-h-28 w-full rounded-lg border border-border bg-background p-2 text-sm" /></div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />{t("ai.bio.confirm")}</label>
      <button type="button" disabled={busy} onClick={() => void run(true)} className="rounded-lg bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-50">{t("ai.bio.save")}</button>
    </section>}
  </div>;
}
