import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveMyBirthdate } from "@/lib/birthdate.functions";

/** Verplichte pop-up wanneer een aanvraag of betaling een geboortedatum vraagt. */
export function BirthdateDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const save = useServerFn(saveMyBirthdate);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await save({ data: { birthdate: value } });
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Opslaan mislukt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Geboortedatum</DialogTitle>
          <DialogDescription>
            Vul je geboortedatum in om deze aanvraag te voltooien. Dit is wettelijk verplicht en
            wordt nooit publiek getoond.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="birthdate">Geboortedatum</Label>
            <Input
              id="birthdate"
              type="date"
              required
              value={value}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || !value}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Opslaan en verdergaan"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
