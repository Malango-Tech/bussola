import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getSession, hasAccount, requirePageTenant } from "@/lib/auth/tenant";

// Every page in this group is per-tenant and reads the database, so none of
// them may be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await hasAccount())) {
    redirect("/signup");
  }
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const repos = await requirePageTenant();
  const [
    dashboardCount,
    connectionCount,
    widgetCount,
    starredDashboards,
    unacknowledgedAlerts,
  ] = await Promise.all([
    repos.dashboards.count(),
    repos.connections.count(),
    repos.widgets.countAll(),
    repos.dashboards.listStarred(),
    repos.alertEvents.unacknowledgedCount(),
  ]);

  return (
    <AppShell
      role={session.role}
      setupState={{
        hasConnection: connectionCount > 0,
        hasDashboard: dashboardCount > 0,
        hasWidget: widgetCount > 0,
      }}
      starredDashboards={starredDashboards.map((dashboard) => ({
        id: dashboard.id,
        name: dashboard.name,
      }))}
      unacknowledgedAlerts={unacknowledgedAlerts}
    >
      {children}
    </AppShell>
  );
}
