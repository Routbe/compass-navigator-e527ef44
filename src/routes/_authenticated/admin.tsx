import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminPortalContext } from "@/components/admin/AdminPortalNav";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPortalLayout,
});

function AdminPortalLayout() {
  return (
    <AdminPortalContext.Provider value={true}>
      <Outlet />
    </AdminPortalContext.Provider>
  );
}
