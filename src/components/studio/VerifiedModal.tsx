import { BadgeCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VerificationPanel } from "@/components/dashboard/VerificationPanel";

/**
 * "ROUT Verified" popup with the Founding Member launch banner. The checkout
 * inside is the existing, working verification flow — prices are unchanged.
 */
export function VerifiedModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 font-display text-2xl tracking-tight">
            <BadgeCheck className="h-6 w-6 text-primary" aria-hidden /> ROUT Verified
          </DialogTitle>
          <DialogDescription>
            Verifieer je identiteit met een officieel document voor maximale betrouwbaarheid.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
          <p className="font-medium">🚀 Founding Member Actie</p>
          <p className="mt-0.5 text-muted-foreground">
            Geverifieerde status nu tijdelijk voor vroege vogels:{" "}
            <strong className="text-foreground">€3,99</strong> i.p.v.{" "}
            <span className="line-through">€99 setup</span>.
          </p>
        </div>
        <VerificationPanel />
      </DialogContent>
    </Dialog>
  );
}
