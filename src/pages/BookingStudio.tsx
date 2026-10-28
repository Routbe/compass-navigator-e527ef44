import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowUp, CalendarClock, Check, Copy, Link2, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import {
  actOnBooking, addBookingCalendar, getBookingStudio, removeBookingCalendar, saveAvailabilityRules,
  saveBookingEventType, setBookingEventTypeActive, syncBookingCalendar,
} from "@/lib/booking-engine/booking.functions";

type Studio = Extract<Awaited<ReturnType<typeof getBookingStudio>>, { ready: true }>;
type EventType = Studio["eventTypes"][number];

const QK = ["booking-studio"];

function useStudio() {
  const fn = useServerFn(getBookingStudio);
  return useQuery({ queryKey: QK, queryFn: () => fn() });
}

function relative(iso: string | null, locale: string) {
  if (!iso) return null;
  const diff = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(diff) < 60) return rtf.format(diff, "minute");
  if (Math.abs(diff) < 1440) return rtf.format(Math.round(diff / 60), "hour");
  return rtf.format(Math.round(diff / 1440), "day");
}

export default function BookingStudio() {
  const { t } = useI18n();
  const q = useStudio();
  return (
    <AppLayout title={t("booking.title")} description={t("booking.description")} crumbs={[{ label: "Studio", to: "/studio" }, { label: t("booking.title") }]}>
      {q.isLoading || !q.data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !q.data.ready ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("booking.err.generic")}</p>
      ) : (
        <Tabs defaultValue="requests" className="space-y-6">
          <TabsList className="flex w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="requests">{t("booking.tab.requests")}</TabsTrigger>
            <TabsTrigger value="types">{t("booking.tab.types")}</TabsTrigger>
            <TabsTrigger value="availability">{t("booking.tab.availability")}</TabsTrigger>
            <TabsTrigger value="calendars">{t("booking.tab.calendars")}</TabsTrigger>
          </TabsList>
          <TabsContent value="requests"><Requests data={q.data} /></TabsContent>
          <TabsContent value="types"><Types data={q.data} /></TabsContent>
          <TabsContent value="availability"><Availability data={q.data} /></TabsContent>
          <TabsContent value="calendars"><Calendars data={q.data} /></TabsContent>
        </Tabs>
      )}
    </AppLayout>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-6">{children}</section>;
}

// ---------- requests ----------

function Requests({ data }: { data: Studio }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const act = useServerFn(actOnBooking);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, action: "confirm" | "decline" | "cancel") => {
    setBusy(id);
    const r = await act({ data: { id, action } }).catch(() => ({ ok: false }));
    setBusy(null);
    if (r.ok) toast.success(t("booking.action.done"));
    else toast.error(t("booking.err.generic"));
    await qc.invalidateQueries({ queryKey: QK });
  };
  if (data.bookings.length === 0) return <Panel><p className="text-sm text-muted-foreground">{t("booking.empty.requests")}</p></Panel>;
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="space-y-3">
      {data.bookings.map((b) => (
        <Panel key={b.id}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{b.title}</span>
                <Badge variant={b.status === "requested" ? "default" : "secondary"}>{t(`booking.status.${b.status}`)}</Badge>
              </div>
              <p className="text-sm text-foreground">{fmt.format(new Date(b.startUtc))}</p>
              <p className="truncate text-sm text-muted-foreground">{b.guestName} · {b.guestEmail} · {b.guestTimezone}</p>
              {b.guestNote && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{b.guestNote}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {b.status === "requested" && (
                <>
                  <Button size="sm" disabled={busy === b.id} onClick={() => run(b.id, "confirm")}><Check className="h-4 w-4" />{t("booking.action.confirm")}</Button>
                  <Button size="sm" variant="soft" disabled={busy === b.id} onClick={() => run(b.id, "decline")}><X className="h-4 w-4" />{t("booking.action.decline")}</Button>
                </>
              )}
              {b.status === "confirmed" && (
                <Button size="sm" variant="soft" disabled={busy === b.id} onClick={() => run(b.id, "cancel")}>{t("booking.action.cancel")}</Button>
              )}
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}

// ---------- event types ----------

type Draft = {
  id: string | null; workspace: boolean; title: string; slug: string; durationMinutes: number; bufferBeforeMinutes: number;
  bufferAfterMinutes: number; minimumNoticeHours: number; maxDaysAhead: number; confirmationMode: "instant" | "request";
  price: string; locationKind: "video" | "address" | "phone"; locationValue: string;
  routingStrategy: "STRICT" | "ROUND_ROBIN" | "COLLECTIVE"; hostUserIds: string[];
};

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "afspraak";

function toDraft(e: EventType | null, userId: string): Draft {
  return e
    ? {
        id: e.id, workspace: Boolean(e.workspaceId), title: e.title, slug: e.slug, durationMinutes: e.durationMinutes,
        bufferBeforeMinutes: e.bufferBeforeMinutes, bufferAfterMinutes: e.bufferAfterMinutes, minimumNoticeHours: e.minimumNoticeHours,
        maxDaysAhead: e.maxDaysAhead, confirmationMode: e.confirmationMode, price: e.priceCents == null ? "" : (e.priceCents / 100).toFixed(2),
        locationKind: e.locationKind, locationValue: e.locationValue ?? "", routingStrategy: e.routingStrategy,
        hostUserIds: e.hosts.map((h) => h.userId),
      }
    : {
        id: null, workspace: false, title: "", slug: "", durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
        minimumNoticeHours: 2, maxDaysAhead: 30, confirmationMode: "instant", price: "", locationKind: "video", locationValue: "",
        routingStrategy: "STRICT", hostUserIds: [userId],
      };
}

function NumberField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" inputMode="numeric" min={min} max={max} step={step ?? 1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Types({ data }: { data: Studio }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toggle = useServerFn(setBookingEventTypeActive);
  const [draft, setDraft] = useState<Draft | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="space-y-4">
      {draft ? (
        <EventTypeForm data={data} draft={draft} setDraft={setDraft} onDone={() => setDraft(null)} />
      ) : (
        <Button onClick={() => setDraft(toDraft(null, data.userId))}><CalendarClock className="h-4 w-4" />{t("booking.type.new")}</Button>
      )}
      {data.eventTypes.length === 0 && !draft && <Panel><p className="text-sm text-muted-foreground">{t("booking.type.empty")}</p></Panel>}
      {data.eventTypes.map((e) => (
        <Panel key={e.id}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{e.title}</span>
                <Badge variant="secondary">{t("booking.public.minutes", { n: e.durationMinutes })}</Badge>
                {e.priceCents != null && <Badge variant="secondary">€ {(e.priceCents / 100).toFixed(2)}</Badge>}
                {e.workspaceId && <Badge variant="outline">{t(`booking.type.routing.${e.routingStrategy}`)}</Badge>}
                <Badge variant="outline">{t(`booking.type.mode.${e.confirmationMode}`)}</Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{origin}/book/{e.id}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={e.isActive} onCheckedChange={async (v) => { await toggle({ data: { id: e.id, active: v } }); await qc.invalidateQueries({ queryKey: QK }); }} />
                {t("booking.type.active")}
              </label>
              <Button size="sm" variant="soft" onClick={() => { void navigator.clipboard.writeText(`${origin}/book/${e.id}`); toast.success(t("booking.type.copied")); }}>
                <Copy className="h-4 w-4" /><span className="sr-only">{t("booking.type.link")}</span>
              </Button>
              <Button size="sm" variant="soft" onClick={() => setDraft(toDraft(e, data.userId))}>{t("booking.type.edit")}</Button>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function EventTypeForm({ data, draft, setDraft, onDone }: { data: Studio; draft: Draft; setDraft: (d: Draft) => void; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const save = useServerFn(saveBookingEventType);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const members = data.members;
  const submit = async () => {
    const price = draft.price.trim() ? Math.round(Number(draft.price.replace(",", ".")) * 100) : null;
    if (!draft.title.trim() || (price != null && (!Number.isFinite(price) || price < 50))) return toast.error(t("booking.err.invalid"));
    const ws = draft.workspace && data.workspaceId;
    setSaving(true);
    const r = await save({
      data: {
        id: draft.id,
        input: {
          ownerUserId: ws ? null : data.userId, workspaceId: ws ? data.workspaceId : null,
          slug: draft.slug || slugify(draft.title), title: draft.title.trim(), description: null,
          durationMinutes: draft.durationMinutes, bufferBeforeMinutes: draft.bufferBeforeMinutes, bufferAfterMinutes: draft.bufferAfterMinutes,
          minimumNoticeHours: draft.minimumNoticeHours, maxDaysAhead: draft.maxDaysAhead, slotStepMinutes: 15,
          confirmationMode: draft.confirmationMode, priceCents: price, currency: "eur",
          routingStrategy: ws ? draft.routingStrategy : "STRICT", locationKind: draft.locationKind,
          locationValue: draft.locationValue.trim() || null,
          hostUserIds: ws ? (draft.routingStrategy === "STRICT" ? draft.hostUserIds.slice(0, 1) : draft.hostUserIds) : [data.userId],
        },
      },
    }).catch(() => ({ ok: false as const, reason: "invalid" }));
    setSaving(false);
    if (!r.ok) return toast.error(r.reason === "slug_taken" ? t("booking.err.slug_taken") : r.reason === "invalid" ? t("booking.err.invalid") : t("booking.err.generic"));
    toast.success(t("booking.type.saved"));
    await qc.invalidateQueries({ queryKey: QK });
    onDone();
  };
  const moveUp = (i: number) => {
    if (i === 0) return;
    const h = [...draft.hostUserIds];
    [h[i - 1], h[i]] = [h[i]!, h[i - 1]!];
    set("hostUserIds", h);
  };
  return (
    <Panel>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("booking.type.name")}</Label>
          <Input value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value, slug: draft.id ? draft.slug : slugify(e.target.value) })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("booking.type.slug")}</Label>
          <Input value={draft.slug} maxLength={63} onChange={(e) => set("slug", slugify(e.target.value))} />
        </div>
        {data.workspaceId && !draft.id && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t("booking.type.owner")}</Label>
            <Select value={draft.workspace ? "ws" : "me"} onValueChange={(v) => setDraft({ ...draft, workspace: v === "ws", hostUserIds: [data.userId], routingStrategy: "STRICT" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="me">{t("booking.type.owner.personal")}</SelectItem>
                <SelectItem value="ws">{t("booking.type.owner.workspace")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <NumberField label={t("booking.type.duration")} value={draft.durationMinutes} min={5} max={480} step={5} onChange={(n) => set("durationMinutes", n)} />
        <NumberField label={t("booking.type.notice")} value={draft.minimumNoticeHours} min={0} max={720} onChange={(n) => set("minimumNoticeHours", n)} />
        <NumberField label={t("booking.type.bufferBefore")} value={draft.bufferBeforeMinutes} min={0} max={240} step={5} onChange={(n) => set("bufferBeforeMinutes", n)} />
        <NumberField label={t("booking.type.bufferAfter")} value={draft.bufferAfterMinutes} min={0} max={240} step={5} onChange={(n) => set("bufferAfterMinutes", n)} />
        <NumberField label={t("booking.type.horizon")} value={draft.maxDaysAhead} min={1} max={365} onChange={(n) => set("maxDaysAhead", n)} />
        <div className="space-y-1.5">
          <Label>{t("booking.type.price")}</Label>
          <Input inputMode="decimal" placeholder="0,00" value={draft.price} onChange={(e) => set("price", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("booking.type.mode")}</Label>
          <Select value={draft.confirmationMode} onValueChange={(v) => set("confirmationMode", v as Draft["confirmationMode"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="instant">{t("booking.type.mode.instant")}</SelectItem>
              <SelectItem value="request">{t("booking.type.mode.request")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("booking.type.location")}</Label>
          <Select value={draft.locationKind} onValueChange={(v) => set("locationKind", v as Draft["locationKind"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="video">{t("booking.type.location.video")}</SelectItem>
              <SelectItem value="address">{t("booking.type.location.address")}</SelectItem>
              <SelectItem value="phone">{t("booking.type.location.phone")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("booking.type.locationValue")}</Label>
          <Input value={draft.locationValue} maxLength={500} onChange={(e) => set("locationValue", e.target.value)} />
        </div>
        {draft.workspace && data.workspaceId && (
          <>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("booking.type.routing")}</Label>
              <Select value={draft.routingStrategy} onValueChange={(v) => setDraft({ ...draft, routingStrategy: v as Draft["routingStrategy"], hostUserIds: v === "STRICT" ? draft.hostUserIds.slice(0, 1) : draft.hostUserIds })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["STRICT", "ROUND_ROBIN", "COLLECTIVE"] as const).map((r) => <SelectItem key={r} value={r}>{t(`booking.type.routing.${r}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("booking.type.hosts")}</Label>
              <div className="space-y-1.5">
                {draft.hostUserIds.map((id, i) => (
                  <div key={id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    <span className="truncate">{i + 1}. {members.find((m) => m.user_id === id)?.name ?? id}</span>
                    <div className="flex gap-1">
                      {draft.routingStrategy !== "STRICT" && i > 0 && <Button size="sm" variant="ghost" onClick={() => moveUp(i)} aria-label={t("booking.type.up")}><ArrowUp className="h-4 w-4" /></Button>}
                      {draft.hostUserIds.length > 1 && <Button size="sm" variant="ghost" onClick={() => set("hostUserIds", draft.hostUserIds.filter((h) => h !== id))}><X className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                ))}
              </div>
              {(draft.routingStrategy !== "STRICT" || draft.hostUserIds.length === 0) && (
                <div className="flex flex-wrap gap-2">
                  {members.filter((m) => !draft.hostUserIds.includes(m.user_id)).map((m) => (
                    <Button key={m.user_id} size="sm" variant="soft" onClick={() => set("hostUserIds", [...draft.hostUserIds, m.user_id])}>+ {m.name}</Button>
                  ))}
                </div>
              )}
              {draft.routingStrategy === "STRICT" && (
                <Select value={draft.hostUserIds[0] ?? ""} onValueChange={(v) => set("hostUserIds", [v])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
          </>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{t("booking.type.save")}</Button>
        <Button variant="soft" onClick={onDone}>{t("booking.public.back")}</Button>
      </div>
    </Panel>
  );
}

// ---------- availability ----------

const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromHm = (s: string) => { const [h, m] = s.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

function Availability({ data }: { data: Studio }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const save = useServerFn(saveAvailabilityRules);
  const browserTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [tz, setTz] = useState(data.rules[0]?.timezone ?? browserTz);
  const [days, setDays] = useState(() =>
    [1, 2, 3, 4, 5, 6, 0].map((wd) => {
      const r = data.rules.find((x) => x.weekday === wd);
      return { wd, on: Boolean(r) || (data.rules.length === 0 && wd >= 1 && wd <= 5), start: r?.startMinute ?? 540, end: r?.endMinute ?? 1020 };
    }),
  );
  const [saving, setSaving] = useState(false);
  const dayName = (wd: number) => new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(Date.UTC(2026, 0, 4 + wd)));
  const submit = async () => {
    setSaving(true);
    const ok = await save({ data: { rules: days.filter((d) => d.on && d.end > d.start).map((d) => ({ weekday: d.wd, startMinute: d.start, endMinute: d.end, timezone: tz })) } }).then(() => true, () => false);
    setSaving(false);
    if (ok) { toast.success(t("booking.type.saved")); await qc.invalidateQueries({ queryKey: QK }); } else toast.error(t("booking.err.generic"));
  };
  return (
    <Panel>
      <p className="mb-4 text-sm text-muted-foreground">{t("booking.avail.intro")}</p>
      <div className="mb-4 max-w-sm space-y-1.5">
        <Label>{t("booking.avail.timezone")}</Label>
        <Input value={tz} onChange={(e) => setTz(e.target.value)} />
      </div>
      <div className="space-y-2">
        {days.map((d, i) => (
          <div key={d.wd} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
            <Switch checked={d.on} onCheckedChange={(v) => setDays(days.map((x, j) => (j === i ? { ...x, on: v } : x)))} />
            <span className="w-28 text-sm font-medium capitalize">{dayName(d.wd)}</span>
            {d.on ? (
              <div className="flex items-center gap-2">
                <Input type="time" step={900} className="w-28" value={toHm(d.start)} onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, start: fromHm(e.target.value) } : x)))} />
                <span className="text-muted-foreground">–</span>
                <Input type="time" step={900} className="w-28" value={toHm(d.end === 1440 ? 1439 : d.end)} onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, end: fromHm(e.target.value) } : x)))} />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">{t("booking.avail.closed")}</span>
            )}
          </div>
        ))}
      </div>
      <Button className="mt-5" onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{t("booking.avail.save")}</Button>
    </Panel>
  );
}

// ---------- calendars ----------

function Calendars({ data }: { data: Studio }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const add = useServerFn(addBookingCalendar);
  const remove = useServerFn(removeBookingCalendar);
  const sync = useServerFn(syncBookingCalendar);
  const [kind, setKind] = useState<"ics" | "caldav">("ics");
  const [form, setForm] = useState({ url: "", label: "", username: "", password: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: QK });
  const submit = async () => {
    setBusy("add");
    const payload = kind === "ics"
      ? { adapter: "ics" as const, label: form.label || null, credentials: { url: form.url.trim().replace(/^webcal:/i, "https:") } }
      : { adapter: "caldav" as const, label: form.label || null, credentials: { url: form.url.trim(), username: form.username, password: form.password } };
    const r = await add({ data: payload }).catch(() => ({ ok: false as const, reason: "invalid" }));
    setBusy(null);
    if (!r.ok) return toast.error(r.reason === "invalid" || r.reason === "invalid_url" ? t("booking.err.invalid") : t("booking.err.generic"));
    toast.success(t("booking.cal.added"));
    setForm({ url: "", label: "", username: "", password: "" });
    await refresh();
  };
  return (
    <div className="space-y-4">
      <Panel>
        <p className="mb-4 text-sm text-muted-foreground">{t("booking.cal.intro")}</p>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button size="sm" variant={kind === "ics" ? "default" : "soft"} onClick={() => setKind("ics")}><Link2 className="h-4 w-4" />{t("booking.cal.ics")}</Button>
          <Button size="sm" variant={kind === "caldav" ? "default" : "soft"} onClick={() => setKind("caldav")}><CalendarClock className="h-4 w-4" />{t("booking.cal.caldav")}</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label>{t("booking.cal.url")}</Label><Input type="url" autoComplete="off" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
          {kind === "caldav" && (
            <>
              <div className="space-y-1.5"><Label>{t("booking.cal.username")}</Label><Input autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>{t("booking.cal.password")}</Label><Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            </>
          )}
          <div className="space-y-1.5 sm:col-span-2"><Label>{t("booking.cal.label")}</Label><Input maxLength={80} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
        </div>
        <Button className="mt-4" onClick={submit} disabled={busy === "add" || !form.url}>{busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}{t("booking.cal.add")}</Button>
      </Panel>
      {data.calendars.length === 0 && <Panel><p className="text-sm text-muted-foreground">{t("booking.cal.empty")}</p></Panel>}
      {data.calendars.map((c) => (
        <Panel key={c.id}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.syncStatus === "ok" ? "bg-primary" : c.syncStatus === "error" ? "bg-destructive" : "bg-muted-foreground"}`} aria-hidden />
                <span className="truncate font-medium">{c.label || (c.adapter === "ics" ? "iCal" : "CalDAV")}</span>
                <Badge variant="outline">{c.adapter.toUpperCase()}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.syncStatus === "error" ? t("booking.cal.error", { code: c.lastErrorCode ?? "?" }) : c.lastSyncedAt ? t("booking.cal.lastSync", { when: relative(c.lastSyncedAt, locale) }) : t("booking.cal.never")}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="soft" disabled={busy === c.id} onClick={async () => { setBusy(c.id); await sync({ data: { id: c.id } }).catch(() => undefined); setBusy(null); await refresh(); }}>
                <RefreshCw className={`h-4 w-4 ${busy === c.id ? "animate-spin" : ""}`} />{t("booking.cal.sync")}
              </Button>
              <Button size="sm" variant="ghost" onClick={async () => { await remove({ data: { id: c.id } }); await refresh(); }} aria-label={t("booking.cal.remove")}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}

