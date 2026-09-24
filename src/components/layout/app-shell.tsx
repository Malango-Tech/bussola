"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { RoleProvider } from "@/components/providers/role-provider";
import type { MemberRole } from "@/lib/auth/roles";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowElbowDownRightIcon,
  BellRingingIcon,
  PlugsConnectedIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { starDashboardAction } from "@/app/(app)/dashboards/actions";
import { BussolaMark } from "@/components/brand/bussola-mark";
import {
  CurrentDashboardProvider,
  useCurrentDashboard,
} from "@/components/layout/current-dashboard-context";
import { UserMenu } from "@/components/layout/user-menu";
import {
  GettingStarted,
  type SetupState,
} from "@/components/onboarding/getting-started";
import { SettingsModal } from "@/components/settings/settings-modal";
import { SettingsModalProvider } from "@/components/settings/settings-modal-context";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboards", label: "Dashboards", icon: SquaresFourIcon },
  { href: "/connections", label: "Connections", icon: PlugsConnectedIcon },
  { href: "/alerts", label: "Alerts", icon: BellRingingIcon },
] as const;

type StarredDashboard = { id: string; name: string };

const STORAGE_KEY = "bussola.sidebar.collapsed";

/**
 * Sidebar collapse, read straight from localStorage.
 *
 * `useSyncExternalStore` rather than an effect that copies the value into
 * state: the server has no localStorage, so getServerSnapshot returns the
 * expanded default and the client swaps in the stored value during hydration
 * without a second render pass. Reads are wrapped because a browser set to
 * block site data throws rather than returning null.
 */
const collapseListeners = new Set<() => void>();

function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* a preference that cannot be stored is not worth failing over */
  }
  for (const listener of collapseListeners) listener();
}

export function AppShell({
  children,
  role,
  setupState,
  starredDashboards,
  unacknowledgedAlerts,
}: {
  children: React.ReactNode;
  /** The signed-in person's role, for hiding controls they cannot use. */
  role: MemberRole;
  setupState: SetupState;
  starredDashboards: StarredDashboard[];
  /** Breaches nobody has looked at yet — the number on the Alerts item. */
  unacknowledgedAlerts: number;
}) {
  return (
    <RoleProvider role={role}>
      <CurrentDashboardProvider>
        <SettingsModalProvider>
          <AppShellBody
            setupState={setupState}
            starredDashboards={starredDashboards}
            unacknowledgedAlerts={unacknowledgedAlerts}
          >
            {children}
          </AppShellBody>
        </SettingsModalProvider>
      </CurrentDashboardProvider>
    </RoleProvider>
  );
}

function AppShellBody({
  children,
  setupState,
  starredDashboards,
  unacknowledgedAlerts,
}: {
  children: React.ReactNode;
  setupState: SetupState;
  starredDashboards: StarredDashboard[];
  unacknowledgedAlerts: number;
}) {
  const pathname = usePathname();
  const { current } = useCurrentDashboard();
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false,
  );

  const toggleCollapsed = useCallback(() => {
    writeCollapsed(!readCollapsed());
  }, []);

  // The currently open dashboard always shows as a sub-tab, and starred ones
  // stay pinned there regardless of what page you're on.
  const starredIds = new Set(starredDashboards.map((d) => d.id));
  const subDashboards: Array<StarredDashboard & { starred: boolean }> = [
    ...(current && !starredIds.has(current.id)
      ? [{ ...current, starred: false }]
      : []),
    ...starredDashboards.map((d) => ({ ...d, starred: true })),
  ];

  return (
    <>
      <div className="flex min-h-screen bg-background">
        <aside
          aria-label="Sidebar"
          className={cn(
            "sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar py-4",
            "transition-[width] duration-100 ease-out motion-reduce:transition-none",
            collapsed ? "w-16 px-2" : "w-60 px-3",
          )}
        >
          <div
            className={cn(
              "mb-5 flex",
              collapsed
                ? "flex-col items-center gap-1"
                : "h-9 items-center justify-between gap-2 px-1",
            )}
          >
            <Link
              href="/dashboards"
              className={cn(
                "flex min-w-0 items-center",
                collapsed ? "justify-center" : "gap-2",
              )}
              aria-label="Bussola home"
            >
              <BussolaMark className="size-5 text-almond-cream-400" />
              {!collapsed ? (
                <span className="truncate text-lg font-semibold tracking-tight">
                  Bussola
                </span>
              ) : null}
            </Link>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      collapsed ? "Expand sidebar" : "Collapse sidebar"
                    }
                    aria-expanded={!collapsed}
                    onClick={toggleCollapsed}
                    className="shrink-0"
                  />
                }
              >
                <SidebarSimpleIcon
                  className="size-4"
                  weight={collapsed ? "fill" : "regular"}
                />
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>
          </div>

          <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
            {NAV.map((item) => {
              const active =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              const className = cn(
                "flex items-center rounded-md text-sm transition-colors",
                collapsed ? "justify-center px-0 py-2.5" : "gap-2 px-3 py-2",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
              );
              /*
               * Unacknowledged breaches, on the item they belong to.
               *
               * A dot rather than the count when collapsed: two characters do
               * not fit in a 40px rail, and the point of the badge there is
               * "something is waiting", not how much.
               */
              const badge =
                item.href === "/alerts" && unacknowledgedAlerts > 0
                  ? unacknowledgedAlerts
                  : 0;

              // Spoken in place of the visible label, so the count a sighted
              // person sees on the item is not lost to a screen reader.
              const accessibleName = badge
                ? `${item.label}, ${badge} unacknowledged`
                : item.label;

              const content = (
                <>
                  <span className="relative flex shrink-0">
                    <Icon
                      className="size-4 shrink-0"
                      weight={active ? "duotone" : "regular"}
                    />
                    {badge && collapsed ? (
                      <span
                        className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-destructive"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  {!collapsed ? (
                    <span className="truncate">{item.label}</span>
                  ) : null}
                  {badge && !collapsed ? (
                    <span className="ml-auto shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] leading-none font-medium text-destructive-foreground tabular-nums">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </>
              );

              const link = !collapsed ? (
                <Link
                  key={item.href}
                  href={item.href}
                  className={className}
                  aria-label={accessibleName}
                  aria-current={active ? "page" : undefined}
                >
                  {content}
                </Link>
              ) : (
                <Tooltip key={item.href}>
                  <TooltipTrigger
                    render={
                      <Link
                        href={item.href}
                        className={className}
                        aria-label={accessibleName}
                        aria-current={active ? "page" : undefined}
                      />
                    }
                  >
                    {content}
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );

              if (item.href !== "/dashboards" || collapsed) return link;

              return (
                <div key={item.href} className="flex flex-col gap-1">
                  {link}
                  {subDashboards.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {subDashboards.map((dashboard) => {
                        const subActive =
                          pathname === `/dashboards/${dashboard.id}`;
                        return (
                          <li key={dashboard.id}>
                            <div
                              className={cn(
                                "group/subtab flex items-center gap-1.5 rounded-md py-1.5 pr-1.5 pl-10 text-sm transition-colors",
                                subActive
                                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                              )}
                            >
                              <ArrowElbowDownRightIcon
                                className="size-3 shrink-0"
                                aria-hidden
                              />
                              <Link
                                href={`/dashboards/${dashboard.id}`}
                                className="min-w-0 flex-1 truncate"
                                aria-current={subActive ? "page" : undefined}
                              >
                                {dashboard.name}
                              </Link>
                              <DashboardStarButton
                                id={dashboard.id}
                                name={dashboard.name}
                                starred={dashboard.starred}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-border pt-2">
            <UserMenu collapsed={collapsed} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          <div className="w-full px-4 py-6 sm:px-5 lg:px-6">{children}</div>
        </main>
      </div>

      <SettingsModal />
      <GettingStarted state={setupState} />
    </>
  );
}

function DashboardStarButton({
  id,
  name,
  starred,
}: {
  id: string;
  name: string;
  starred: boolean;
}) {
  const router = useRouter();
  const [optimisticStarred, setOptimisticStarred] = useState(starred);
  const [pending, setPending] = useState(false);

  async function toggleStar(event: React.MouseEvent) {
    event.preventDefault();
    const next = !optimisticStarred;
    setOptimisticStarred(next);
    setPending(true);
    const result = await starDashboardAction(id, next);
    setPending(false);
    if (!result.ok) {
      setOptimisticStarred(!next);
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      aria-label={optimisticStarred ? `Unstar ${name}` : `Star ${name}`}
      aria-pressed={optimisticStarred}
      disabled={pending}
      onClick={toggleStar}
      className={cn(
        "shrink-0 rounded p-1 transition-colors hover:bg-sidebar-accent",
        optimisticStarred
          ? "opacity-100"
          : "opacity-0 focus-visible:opacity-100 group-hover/subtab:opacity-100",
      )}
    >
      <StarIcon
        className={cn(
          "size-3.5",
          optimisticStarred && "text-almond-cream-400",
        )}
        weight={optimisticStarred ? "fill" : "regular"}
      />
    </button>
  );
}
