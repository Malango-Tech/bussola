"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
  type ResponsiveLayouts,
} from "react-grid-layout";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  FloppyDiskIcon,
  PencilSimpleIcon,
  ShareNetworkIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { EmptyState, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { AddWidgetSheet } from "@/components/dashboard/add-widget-sheet";
import { ShareDialog } from "@/components/dashboard/share-dialog";
import { WidgetFrame } from "@/components/dashboard/widget-frame";
import { WidgetSettingsDialog } from "@/components/dashboard/widget-settings-dialog";
import { useCurrentDashboard } from "@/components/layout/current-dashboard-context";
import { starDashboardAction } from "@/app/(app)/dashboards/actions";
import type { WidgetConfig } from "@/lib/widgets/config";
import { getWidgetDefinition, type WidgetType } from "@/lib/widgets/registry";
import { refreshAllWidgets } from "@/lib/widgets/widget-data-store";
import type { Provider } from "@/lib/providers";
import { cn } from "@/lib/utils";
import "react-grid-layout/css/styles.css";

export type CanvasWidget = {
  id: string;
  widgetType: string;
  title?: string | null;
  connectionId: string | null;
  config: WidgetConfig;
  layout: { i: string; x: number; y: number; w: number; h: number };
};

/** Just enough of a connection to name it in a picker. */
export type ConnectionOption = {
  id: string;
  provider: Provider;
  label: string;
};

type DashboardCanvasProps = {
  dashboardId: string;
  name: string;
  initialWidgets: CanvasWidget[];
  initialStarred: boolean;
  /** Whether this plan may create read-only links at all. */
  canShare: boolean;
};

export function DashboardCanvas({
  dashboardId,
  name,
  initialWidgets,
  initialStarred,
  canShare,
}: DashboardCanvasProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setCurrent } = useCurrentDashboard();
  const { width, containerRef, mounted } = useContainerWidth();
  const [editMode, setEditMode] = useState(false);
  const [widgets, setWidgets] = useState(initialWidgets);
  const [saving, setSaving] = useState(false);
  // A dashboard lands here fresh from creation with ?addWidget=1 — open the
  // gallery immediately instead of making the user find the button.
  const [addWidgetOpen, setAddWidgetOpen] = useState(
    () => searchParams.get("addWidget") === "1",
  );
  const [starred, setStarred] = useState(initialStarred);
  const [starring, setStarring] = useState(false);
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  /*
   * The source picker needs to know what exists, and only the settings dialog
   * uses it — but loading it there would refetch on every open. One fetch per
   * canvas, reused by every widget's dialog.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/connections");
        if (!res.ok) return;
        const json = (await res.json()) as { connections?: ConnectionOption[] };
        if (!cancelled) setConnections(json.connections ?? []);
      } catch {
        // A canvas that cannot list connections still renders every widget;
        // only the source picker degrades, so this is not worth a toast.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** How a widget's source should be labelled, when it is worth labelling. */
  const sourceLabelFor = useCallback(
    (widget: CanvasWidget): string | null => {
      const def = getWidgetDefinition(widget.widgetType);
      if (!def || def.provider === "multi") return null;

      const forProvider = connections.filter((c) => c.provider === def.provider);
      // With one connection there is nothing to disambiguate.
      if (forProvider.length < 2) return null;

      const pinned = widget.connectionId
        ? forProvider.find((c) => c.id === widget.connectionId)
        : forProvider[0];
      return pinned?.label ?? null;
    },
    [connections],
  );

  async function saveWidgetSettings(
    widgetId: string,
    patch: {
      title: string | null;
      connectionId: string | null;
      config: WidgetConfig;
    },
  ): Promise<boolean> {
    const res = await fetch(`/api/dashboards/${dashboardId}/widgets`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetId, ...patch }),
    });
    const data = (await res.json()) as {
      widget?: CanvasWidget;
      error?: string;
    };
    if (!res.ok || !data.widget) {
      toast.error(data.error || "Could not save widget settings");
      return false;
    }

    setWidgets((prev) =>
      prev.map((w) =>
        w.id === widgetId ? { ...data.widget!, layout: w.layout } : w,
      ),
    );
    // A repointed widget must not keep showing the old account's numbers
    // until the next poll comes round.
    refreshAllWidgets();
    return true;
  }

  async function toggleStarred() {
    const next = !starred;
    setStarring(true);
    setStarred(next);
    const result = await starDashboardAction(dashboardId, next);
    setStarring(false);
    if (!result.ok) {
      setStarred(!next);
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  useEffect(() => {
    if (searchParams.get("addWidget") !== "1") return;
    router.replace(`/dashboards/${dashboardId}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The sidebar has no way to know a dynamic route's data on its own, so the
  // open dashboard reports itself for the "current" sub-tab.
  useEffect(() => {
    setCurrent({ id: dashboardId, name });
    return () => setCurrent(null);
  }, [dashboardId, name, setCurrent]);

  const layout: Layout = useMemo(
    () =>
      widgets.map((w) => {
        const def = getWidgetDefinition(w.widgetType);
        return {
          i: w.id,
          x: w.layout.x,
          y: w.layout.y,
          w: w.layout.w,
          h: w.layout.h,
          minW: def?.minW ?? 2,
          minH: def?.minH ?? 2,
          static: !editMode,
        };
      }),
    [widgets, editMode],
  );

  const layouts: ResponsiveLayouts = useMemo(
    () => ({ lg: layout, md: layout, sm: layout }),
    [layout],
  );

  const persistLayout = useCallback(
    async (next: Layout) => {
      setSaving(true);
      const res = await fetch(`/api/dashboards/${dashboardId}/widgets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layouts: next.map((item) => ({
            i: item.i,
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
          })),
        }),
      });
      setSaving(false);
      if (!res.ok) {
        toast.error("Failed to save layout");
      }
    },
    [dashboardId],
  );

  async function addWidget(type: WidgetType) {
    const res = await fetch(`/api/dashboards/${dashboardId}/widgets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetType: type }),
    });
    const data = (await res.json()) as {
      widget?: CanvasWidget;
      error?: string;
    };
    if (!res.ok || !data.widget) {
      toast.error(data.error || "Failed to add widget");
      return;
    }
    setWidgets((prev) => [...prev, data.widget!]);
    setEditMode(true);
    toast.success("Widget added");
  }

  async function removeWidget(id: string) {
    const res = await fetch(
      `/api/dashboards/${dashboardId}/widgets?widgetId=${id}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      toast.error("Failed to remove widget");
      return;
    }
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }

  const settingsWidget = settingsFor
    ? widgets.find((w) => w.id === settingsFor) ?? null
    : null;

  const widgetCount = widgets.length;
  const description = editMode
    ? "Drag and resize blocks — changes save automatically."
    : widgetCount === 0
      ? "No widgets yet."
      : `${widgetCount} widget${widgetCount === 1 ? "" : "s"}.`;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link
          href="/dashboards"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Dashboards
        </Link>
        <PageHeader
          title={name}
          description={description}
          actions={
            <>
              {saving ? (
                <span className="text-xs text-muted-foreground">Saving…</span>
              ) : null}
              <AddWidgetSheet
                open={addWidgetOpen}
                onOpenChange={setAddWidgetOpen}
                onAdd={addWidget}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Share dashboard"
                onClick={() => setShareOpen(true)}
              >
                <ShareNetworkIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={starred ? "Unstar dashboard" : "Star dashboard"}
                aria-pressed={starred}
                disabled={starring}
                onClick={toggleStarred}
              >
                <StarIcon
                  className="size-4"
                  weight={starred ? "fill" : "regular"}
                  aria-hidden
                />
              </Button>
              <Button
                type="button"
                variant={editMode ? "default" : "outline"}
                onClick={() => setEditMode((v) => !v)}
              >
                {editMode ? (
                  <FloppyDiskIcon className="size-4" />
                ) : (
                  <PencilSimpleIcon className="size-4" />
                )}
                {editMode ? "Done" : "Edit"}
              </Button>
            </>
          }
        />
      </div>

      {widgets.length === 0 ? (
        <EmptyState
          title="Empty canvas"
          description="Add a tracker or KPI block to start composing this dashboard."
          action={
            <Button type="button" onClick={() => setAddWidgetOpen(true)}>
              Add widget
            </Button>
          }
        />
      ) : (
        <div
          ref={containerRef}
          className={cn("min-h-[420px]", editMode && "edit-mode-grid rounded-lg")}
        >
          {mounted ? (
            <ResponsiveGridLayout
              className="layout"
              width={width}
              layouts={layouts}
              breakpoints={{ lg: 1024, md: 768, sm: 0 }}
              cols={{ lg: 12, md: 8, sm: 4 }}
              rowHeight={72}
              margin={[16, 16] as const}
              dragConfig={{
                enabled: editMode,
                handle: ".drag-handle",
              }}
              resizeConfig={{
                enabled: editMode,
              }}
              onDragStop={(next) => {
                setWidgets((prev) =>
                  prev.map((w) => {
                    const item = next.find((l) => l.i === w.id);
                    if (!item) return w;
                    return {
                      ...w,
                      layout: {
                        i: w.id,
                        x: item.x,
                        y: item.y,
                        w: item.w,
                        h: item.h,
                      },
                    };
                  }),
                );
                void persistLayout(next);
              }}
              onResizeStop={(next) => {
                setWidgets((prev) =>
                  prev.map((w) => {
                    const item = next.find((l) => l.i === w.id);
                    if (!item) return w;
                    return {
                      ...w,
                      layout: {
                        i: w.id,
                        x: item.x,
                        y: item.y,
                        w: item.w,
                        h: item.h,
                      },
                    };
                  }),
                );
                void persistLayout(next);
              }}
            >
              {widgets.map((widget) => (
                <div key={widget.id}>
                  <WidgetFrame
                    id={widget.id}
                    type={widget.widgetType as WidgetType}
                    title={widget.title}
                    connectionId={widget.connectionId}
                    config={widget.config}
                    sourceLabel={sourceLabelFor(widget)}
                    editMode={editMode}
                    onRemove={removeWidget}
                    onConfigure={setSettingsFor}
                  />
                </div>
              ))}
            </ResponsiveGridLayout>
          ) : null}
        </div>
      )}

      {settingsWidget ? (
        <WidgetSettingsDialog
          widget={{
            id: settingsWidget.id,
            widgetType: settingsWidget.widgetType as WidgetType,
            title: settingsWidget.title ?? null,
            connectionId: settingsWidget.connectionId,
            config: settingsWidget.config,
          }}
          connections={connections}
          onClose={() => setSettingsFor(null)}
          onSave={(patch) => saveWidgetSettings(settingsWidget.id, patch)}
        />
      ) : null}

      {shareOpen ? (
        <ShareDialog
          dashboardId={dashboardId}
          dashboardName={name}
          canShare={canShare}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </div>
  );
}
