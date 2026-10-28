import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RoutLogo } from "@/components/RoutLogo";
import { verifyGoLink } from "@/lib/go-link.functions";

type GoSearch = { i?: string; a?: string; w?: string; s?: string };

/** Pick the right destination from the user agent, entirely client-side. */
function pickTarget(ua: string, s: GoSearch): string | undefined {
  if (/iphone|ipad|ipod/i.test(ua) || (/mac/i.test(ua) && "ontouchend" in document)) {
    return s.i ?? s.w ?? s.a;
  }
  if (/android/i.test(ua)) return s.a ?? s.w ?? s.i;
  return s.w ?? s.i ?? s.a;
}

function GoPage() {
  const search = useSearch({ from: "/go" });
  const [target, setTarget] = useState<string | undefined>();
  const [needsConfirm, setNeedsConfirm] = useState(false);

  useEffect(() => {
    const s = search as GoSearch;
    const to = pickTarget(navigator.userAgent, s);
    setTarget(to);
    if (!to) return;
    let safe = false;
    try {
      const p = new URL(to).protocol;
      safe = p === "https:" || p === "http:";
    } catch {
      safe = false;
    }
    if (!safe) {
      setTarget(undefined);
      return;
    }
    verifyGoLink({ data: { i: s.i, a: s.a, w: s.w, s: s.s } })
      .then((r) => (r.valid ? window.location.replace(to) : setNeedsConfirm(true)))
      .catch(() => setNeedsConfirm(true));
  }, [search]);

  if (needsConfirm && target) {
    let host = target;
    try {
      host = new URL(target).host;
    } catch {
      /* keep raw */
    }
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-6 text-center">
        <RoutLogo size={26} />
        <h1 className="font-display text-2xl text-foreground">You are leaving ROUT</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This link sends you to <span className="font-mono text-foreground">{host}</span>. Only continue if you trust it.
        </p>
        <a href={target} rel="noopener noreferrer nofollow" className="text-sm text-foreground underline underline-offset-4">
          Continue to {host}
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-6 text-center">
      <RoutLogo size={26} />
      <h1 className="font-display text-2xl text-foreground">Taking you to the app…</h1>
      {target ? (
        <a href={target} className="text-sm text-foreground underline underline-offset-4">
          Continue manually
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">This link has no destination configured.</p>
      )}
    </div>
  );
}

export const Route = createFileRoute("/go")({
  validateSearch: (search: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(search).filter(([, v]) => typeof v === "string")) as Record<
      string,
      string | undefined
    >,
  head: () => ({
    meta: [
      { title: "Doorverwijzen… | ROUT" },
      {
        name: "description",
        content: "Slimme doorverwijzing naar de juiste app of website voor jouw toestel.",
      },
      { property: "og:title", content: "Doorverwijzen… | ROUT" },
      {
        property: "og:description",
        content: "Slimme doorverwijzing naar de juiste app of website voor jouw toestel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GoPage,
});
