import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useConsoleApp } from "@/components/console/console-data";

/** App context. Navigation lives in the console's left sidebar. */
export const Route = createFileRoute("/_authenticated/console/apps/$appId")({
  component: AppLayout,
});

function AppLayout() {
  const { appId } = Route.useParams();
  const { app, isLoading } = useConsoleApp(appId);
  if (isLoading) return <p className="p-10 text-sm text-muted-foreground">Laden…</p>;
  if (!app) return <p className="p-10 text-sm text-muted-foreground">Deze app bestaat niet of je hebt er geen toegang toe.</p>;
  return <Outlet />;
}
