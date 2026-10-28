import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ChevronLeft, Lightbulb } from "lucide-react";
import { Accordion } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { auditProfile, hasPrimaryAction } from "@/lib/conversion-coach";
import { cn } from "@/lib/utils";
import { ConversionCoachAccordion } from "./ConversionCoachAccordion";

type Props = ComponentProps<typeof ConversionCoachAccordion>;
const HIDE_KEY = "rout.coachFab.hidden";

/** Floating lightbulb with the live score; opens the coach. Big tap target, collapses while scrolling, can be tucked away. */
export function ConversionCoachFab(props: Props) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [compact, setCompact] = useState(false);
  const isMobile = useIsMobile();
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { blocks, avatarUrl, bio, prefs } = props;
  const score = auditProfile({
    blocks,
    avatarUrl,
    bio,
    hasPrimaryAction: hasPrimaryAction(blocks),
    highlightActive: prefs.ctaEffect !== "none" && Boolean(prefs.ctaBlockId),
    metaTitle: prefs.metaTitle,
    metaDescription: prefs.metaDescription,
    ogImageUrl: prefs.ogImageUrl,
  }).score;

  useEffect(() => {
    setHidden(window.localStorage.getItem(HIDE_KEY) === "1");
    const onScroll = () => {
      setCompact(true);
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => setCompact(false), 700);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (idle.current) clearTimeout(idle.current);
    };
  }, []);

  function setHide(v: boolean) {
    setHidden(v);
    window.localStorage.setItem(HIDE_KEY, v ? "1" : "0");
  }

  const bottom = { bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" };

  return (
    <>
      {hidden ? (
        <button
          type="button"
          onClick={() => setHide(false)}
          aria-label="Conversie Coach tonen"
          style={bottom}
          className="fixed right-0 z-40 flex h-12 w-6 items-center justify-center rounded-l-lg border border-r-0 border-border bg-card shadow-md md:!bottom-5"
        >
          <ChevronLeft className="h-4 w-4 text-primary" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Conversie Coach openen, score ${score} van 100`}
          style={bottom}
          className={cn(
            "fixed right-3 z-40 flex min-h-12 touch-manipulation items-center gap-2 rounded-full border border-border bg-card p-2 shadow-lg transition-all md:!bottom-5 md:right-5 md:hover:scale-105",
            compact ? "opacity-70" : "pr-4",
          )}
        >
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary/15">
            <Lightbulb className="h-4 w-4 text-primary" aria-hidden />
            {score < 100 && (
              <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
            )}
          </span>
          {!compact && <span className="text-sm font-semibold tabular-nums">{score}/100</span>}
        </button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn("overflow-y-auto", isMobile ? "max-h-[85vh] rounded-t-2xl" : "w-full sm:max-w-md")}
        >
          <SheetHeader>
            <SheetTitle>💡 Conversie Coach</SheetTitle>
          </SheetHeader>
          <Accordion type="single" collapsible defaultValue="conversion_tips" className="mt-4">
            <ConversionCoachAccordion {...props} />
          </Accordion>
          <Button
            variant="ghost"
            size="sm"
            className="mt-4 text-muted-foreground"
            onClick={() => { setHide(true); setOpen(false); }}
          >
            Knop verbergen
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}
