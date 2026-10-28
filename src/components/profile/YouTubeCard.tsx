import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { proxied } from "@/lib/image-proxy-rules";
import { formatCount, type YouTubeCard as Card } from "@/lib/youtube-format";

type Theme = { card: string; border: string; text: string; muted: string };

/** Presentational YouTube channel card (profile + Studio preview). */
export function YouTubeCardView({ card, theme }: { card: Card; theme: Theme }) {
  const { t } = useTranslation();
  const avatar = proxied(card.avatar);
  return (
    <div
      className="w-full rounded-2xl border p-4 text-left"
      style={{ background: theme.card, borderColor: theme.border, color: theme.text }}
    >
      <a href={card.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3">
        {avatar ? (
          <img src={avatar} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="h-12 w-12 shrink-0 rounded-full" style={{ background: theme.border }} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{card.title}</p>
          <p className="text-xs" style={{ color: theme.muted }}>
            {card.subscribers != null && <>{formatCount(card.subscribers)}  {t("profile.subscribersSuffix")} </>}
            {formatCount(card.views)}  {t("profile.views")} {card.videoCount != null && <> · {formatCount(card.videoCount)}  {t("profile.videos")} </>}
          </p>
        </div>
        <span className="text-xs font-medium" style={{ color: theme.muted }}>YouTube ↗</span>
      </a>
      {card.videos.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {card.videos.map((v) => {
            const thumb = proxied(v.thumb);
            return (
              <li key={v.id}>
                <a href={v.url} target="_blank" rel="noopener noreferrer" className="block">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="aspect-video w-full rounded-lg object-cover"
                    />
                  ) : (
                    <span className="block aspect-video w-full rounded-lg" style={{ background: theme.border }} />
                  )}
                  <span className="mt-1 line-clamp-2 block text-xs">{v.title}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Public profile card: renders nothing unless the member linked and enabled it. */
export function ProfileYouTubeCard({ handle, theme }: { handle: string; theme: Theme }) {
  const q = useQuery({
    queryKey: ["youtube-card", handle],
    queryFn: async (): Promise<Card | null> => {
      const r = await fetch(`/api/public/youtube/card?handle=${encodeURIComponent(handle)}`);
      if (!r.ok) return null;
      return ((await r.json()) as { card: Card | null }).card;
    },
    staleTime: 5 * 60_000,
  });
  if (!q.data) return null;
  return <YouTubeCardView card={q.data} theme={theme} />;
}
