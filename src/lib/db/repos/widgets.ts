import { and, asc, count, eq, sql } from "drizzle-orm";
import { createId } from "@/lib/id";
import { getDb } from "..";
import { valuesTable } from "../batch";
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

  /*
   * The widget lists are complete on purpose. A canvas must render every
   * widget it has, and the per-type lists feed counts ("3 widgets read from
   * this connection") that a bound would make wrong. Plans cap widgets per
   * dashboard, which is what keeps them small.
   */
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

    /**
     * Next free row on the canvas, so a new widget never lands on top.
     *
     * Asked of the database as one number rather than computed over every
     * widget row: the answer is an aggregate, and fetching the rows only to
     * reduce them is the same query with a payload attached.
     */
    async nextY(dashboardId: string) {
      const db = await getDb();
      const [row] = await db
        .select({
          value: sql`coalesce(max(${dashboardWidgets.layoutY} + ${dashboardWidgets.layoutH}), 0)`.mapWith(
            Number,
          ),
        })
        .from(dashboardWidgets)
        .where(
          and(
            eq(dashboardWidgets.dashboardId, dashboardId),
            eq(dashboardWidgets.organizationId, org),
          ),
        );
      return row?.value ?? 0;
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
     *
     * One statement for the whole canvas. A drag reflows every widget below
     * it, and this used to be one UPDATE per widget with no transaction: a
     * failure half-way left the canvas half-moved, overlapping itself. Now the
     * layout lands entirely or not at all. Returns how many widgets moved.
     */
    async saveLayouts(
      dashboardId: string,
      layouts: Array<{ i: string; x: number; y: number; w: number; h: number }>,
    ) {
      // A repeated id keeps its last position, as it did when every item was
      // its own UPDATE applied in order.
      const latest = new Map(layouts.map((item) => [item.i, item]));
      if (latest.size === 0) return 0;

      const layout = valuesTable(
        "layout",
        { id: "text", x: "integer", y: "integer", w: "integer", h: "integer" },
        [...latest.values()].map(({ i, x, y, w, h }) => ({ id: i, x, y, w, h })),
      );

      const db = await getDb();
      const rows = await db
        .update(dashboardWidgets)
        .set({
          layoutX: layout.column("x"),
          layoutY: layout.column("y"),
          layoutW: layout.column("w"),
          layoutH: layout.column("h"),
          updatedAt: new Date(),
        })
        .from(layout.from)
        .where(
          and(
            eq(dashboardWidgets.id, layout.column("id")),
            eq(dashboardWidgets.dashboardId, dashboardId),
            eq(dashboardWidgets.organizationId, org),
          ),
        )
        .returning({ id: dashboardWidgets.id });
      return rows.length;
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
