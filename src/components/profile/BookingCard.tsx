import { useTranslation } from "react-i18next";
import { useState, type CSSProperties } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Altcha } from "@/components/Altcha";
import { takeProof } from "@/lib/altcha-client";
import { requestBooking } from "@/lib/booking.functions";
import {
  BOOKING_MESSAGE_MAX,
  BOOKING_TIME_SLOTS,
  todayIso,
  type BookingConfig,
} from "@/lib/booking";

/**
 * Publieke boekingskaart. Modus "direct" toont het ROUT-aanvraagformulier,
 * modus "embed" opent een Cal.com/Google-agenda in een overlay.
 */
export function BookingCard({
  handle,
  config,
  style,
}: {
  handle: string;
  config: BookingConfig;
  style: CSSProperties;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState<string>(BOOKING_TIME_SLOTS[0]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const embedUrl = config.embedUrl.trim();
  const embed = embedUrl
    ? embedUrl.includes("?")
      ? `${embedUrl}&embed=true`
      : `${embedUrl}?embed=true`
    : "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await requestBooking({
        data: {
          handle,
          guestName: name.trim(),
          guestEmail: email.trim(),
          preferredDate: date,
          preferredTime: time,
          guestMessage: message.trim() || null,
          altcha: await takeProof(),
        },
      });
      if (res.ok) {
        setDone(true);
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("profile.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-opacity hover:opacity-80"
        style={style}
      >
        <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-center">
          {config.title || t("profile.bookingTitle")}
        </span>
        <span className="h-4 w-4 shrink-0" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={config.mode === "embed" ? "max-w-3xl p-0" : "max-w-md"}>
          <DialogHeader className={config.mode === "embed" ? "px-4 pt-4" : undefined}>
            <DialogTitle>{config.title || t("profile.bookingTitle")}</DialogTitle>
          </DialogHeader>

          {config.mode === "embed" ? (
            embed ? (
              <iframe
                src={embed}
                title={config.title || t("profile.bookingCalendar")}
                className="h-[70vh] w-full rounded-b-lg border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : (
              <p className="px-1 pb-4 text-sm text-muted-foreground">
                 {t("profile.calendarNotSet")} </p>
            )
          ) : done ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-900">
               {t("profile.bookingSent")} </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              {config.note && <p className="text-sm text-muted-foreground">{config.note}</p>}
              <p className="text-xs text-muted-foreground"> {t("profile.duration")} {config.duration}  {t("profile.minutes")} </p>

              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="booking-name">
                   {t("profile.fullName")} </label>
                <input
                  id="booking-name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="booking-email">
                   {t("profile.email")} </label>
                <input
                  id="booking-email"
                  type="email"
                  required
                  maxLength={200}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium" htmlFor="booking-date">
                     {t("profile.date")} </label>
                  <input
                    id="booking-date"
                    type="date"
                    required
                    min={todayIso()}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium" htmlFor="booking-time">
                     {t("profile.time")} </label>
                  <select
                    id="booking-time"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                  >
                    {BOOKING_TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="booking-message">
                   {t("profile.bookingMessage")} </label>
                <textarea
                  id="booking-message"
                  rows={3}
                  maxLength={BOOKING_MESSAGE_MAX}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                />
                <p className="text-right text-[11px] text-muted-foreground">
                  {message.length}/{BOOKING_MESSAGE_MAX}
                </p>
              </div>

              <Altcha />

              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                 {t("profile.requestBooking")} </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
