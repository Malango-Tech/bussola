import { and, asc, count, eq } from "drizzle-orm";
import { createId } from "@/lib/id";
import { getDb } from "..";
import { dashboardWidgets } from "../schema";
import type { TenantContext } from "./context";

export function widgetsRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  const ownWidget = (dashboardId: string, widgetId: string) =>
    and(
      eq(dashboardWidgets.id, widgetId),
      eq(dashboardWidgets.dashboardId, dashboardId),
      eq(dashboardWidgets.organizationId, org),
    );

  return {
    async listFor(dashboardId: string) {
      const db = await getDb();
      return db
        .select()
        .from(dashboardWidgets)
        .where(
          and(
            eq(dashboardWidgets.dashboardId, dashboardId),
            eq(dashboardWidgets.organizationId, org),
          ),
        )
        .orderBy(
          asc(dashboardWidgets.layoutY),
          asc(dashboardWidgets.layoutX),
        );
    },

    /** Widget types in use, for showing what a connection feeds. */
    async listTypes() {
      const db = await getDb();
      const rows = await db
        .select({ widgetType: dashboardWidgets.widgetType })
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.organizationId, org));
      return rows.map((row) => row.widgetType);
    },

    /** Widget types per dashboard, in layout order, for gallery thumbnails. */
    async listTypesByDashboard() {
      const db = await getDb();
      return db
        .select({
          dashboardId: dashboardWidgets.dashboardId,
          widgetType: dashboardWidgets.widgetType,
        })
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.organizationId, org))
        .orderBy(asc(dashboardWidgets.layoutY), asc(dashboardWidgets.layoutX));
    },

    /** Widgets across every dashboard, for the setup checklist. */
    async countAll() {
      const db = await getDb();
      const [row] = await db
        .select({ value: count() })
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.organizationId, org));
      return row?.value ?? 0;
    },

    async countFor(dashboardId: string) {
      const db = await getDb();
      const [row] = await db
        .select({ value: count() })
        .from(dashboardWidgets)
        .where(
          and(
            eq(dashboardWidgets.dashboardId, dashboardId),
            eq(dashboardWidgets.organizationId, org),
          ),
        );
      return row?.value ?? 0;
    },

    /** Next free row on the canvas, so a new widget never lands on top. */
    async nextY(dashboardId: string) {
      const rows = await this.listFor(dashboardId);
      return rows.reduce(
        (acc, w) => Math.max(acc, w.layoutY + w.layoutH),
        0,
      );
    },

    async get(dashboardId: string, widgetId: string) {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(dashboardWidgets)
        .where(ownWidget(dashboardId, widgetId))
        .limit(1);
      return row ?? null;
    },

    async add(input: {
      dashboardId: string;
      widgetType: string;
      title: string;
      configJson: string;
      connectionId?: string | null;
      layoutY: number;
      layoutW: number;
      layoutH: number;
    }) {
      const db = await getDb();
      const [row] = await db
        .insert(dashboardWidgets)
        .values({
          id: createId("wdg"),
          organizationId: org,
          dashboardId: input.dashboardId,
          widgetType: input.widgetType,
          title: input.title,
          configJson: input.configJson,
          connectionId: input.connectionId ?? null,
          layoutX: 0,
          layoutY: input.layoutY,
          layoutW: input.layoutW,
          layoutH: input.layoutH,
        })
        .returning();
      return row;
    },

    /**
     * Change what a widget shows: its heading, which connection feeds it, and
     * its own options.
     *
     * Every field is optional and only the ones present are written, so the
     * settings dialog can save one control without having to send back the
     * rest of the widget's state.
     */
    async update(
      dashboardId: string,
      widgetId: string,
      input: {
        title?: string | null;
        connectionId?: string | null;
        configJson?: string;
      },
    ) {
      const db = await getDb();
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if ("title" in input) patch.title = input.title;
      if ("connectionId" in input) patch.connectionId = input.connectionId;
      if ("configJson" in input) patch.configJson = input.configJson;

      const [row] = await db
        .update(dashboardWidgets)
        .set(patch)
        .where(ownWidget(dashboardId, widgetId))
        .returning();
      return row ?? null;
    },

    /**
     * Layout writes are filtered by dashboard *and* organization, so a widget
     * id belonging to another dashboard (or another tenant) silently matches
     * nothing instead of being moved.
     */
    async saveLayouts(
      dashboardId: string,
      layouts: Array<{ i: string; x: number; y: number; w: number; h: number }>,
    ) {
      const db = await getDb();
      const now = new Date();
      let updated = 0;
      for (const item of layouts) {
        const rows = await db
          .update(dashboardWidgets)
          .set({
            layoutX: item.x,
            layoutY: item.y,
            layoutW: item.w,
            layoutH: item.h,
            updatedAt: now,
          })
          .where(ownWidget(dashboardId, item.i))
          .returning({ id: dashboardWidgets.id });
        updated += rows.length;
      }
      return updated;
    },

    async remove(dashboardId: string, widgetId: string) {
      const db = await getDb();
      const rows = await db
        .delete(dashboardWidgets)
        .where(ownWidget(dashboardId, widgetId))
        .returning({ id: dashboardWidgets.id });
      return rows.length > 0;
    },
  };
}
