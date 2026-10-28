import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2 } from "lucide-react";
import { getSunsetStatus } from "@/lib/workspace-conversion.functions";

/** Non-dismissible notice for logins of accounts that became a Workspace. */
export function SunsetOverlay() {
  const fn = useServerFn(getSunsetStatus);
  const { data } = useQuery({ queryKey: ["sunset-status"], queryFn: () => fn(), staleTime: 60_000 });
  if (!data) return null;
  const date = data.sunsetAt ? new Date(data.sunsetAt).toLocaleDateString("nl-BE", { day: "numeric", month: "long", year: "numeric" }) : "";
  return (
    <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 px-4 backdrop-blur">
      <div className="max-w-md space-y-3 text-center">
        <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Deze entiteit is nu een Workspace</h1>
        <p className="text-muted-foreground">
          {data.workspaceName ? <strong className="text-foreground">{data.workspaceName}</strong> : "Dit account"} wordt beheerd via een persoonlijk account.
          Log in via je persoonlijke account.
        </p>
        {date && <p className="text-sm text-muted-foreground">Deze inlogmethode vervalt op {date}.</p>}
        <a href="/auth/sign-in" className="inline-block text-sm underline">Inloggen met een ander account</a>
      </div>
    </div>
  );
}
