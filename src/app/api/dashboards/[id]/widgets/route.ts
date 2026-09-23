import { z } from "zod";
import { jsonError, jsonOk, withTenant } from "@/lib/api";
import { overLimit } from "@/lib/billing/guard";
import { getWidgetDefinition } from "@/lib/widgets/registry";
import { isMultiSource, parseWidgetConfig } from "@/lib/widgets/config";
import { toCanvasWidget } from "@/lib/widgets/serialize";
import type { TenantRepos } from "@/lib/db/tenant";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const addSchema = z.object({
  widgetType: z.string(),
  title: z.string().max(120).optional(),
  connectionId: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Check that a connection exists, belongs to this tenant, and matches the
 * widget's provider.
 *
 * The tenant check is what stops a widget id from one organization being
 * pointed at another's Stripe account: `repos.connections.get` is already
 * organization-filtered, so a foreign id simply resolves to nothing — and is
 * answered 404, exactly like an id that never existed, so the response says
 * nothing about another tenant. The provider check stops a Railway widget
 * being pointed at a Qonto connection, which would render an empty box rather
 * than an error.
 */
async function resolveConnection(
  repos: TenantRepos,
  widgetType: string,
  connectionId: string | null | undefined,
): Promise<
  | { ok: true; value: string | null }
  | { ok: false; error: string; status: number }
> {
  if (connectionId == null) return { ok: true, value: null };

  const connection = await repos.connections.get(connectionId);
  if (!connection) {
    return { ok: false, error: "Connection not found", status: 404 };
  }

  const def = getWidgetDefinition(widgetType);
  if (def && def.provider !== "multi" && def.provider !== connection.provider) {
    return {
      ok: false,
      error: `This widget reads ${def.provider}, not ${connection.provider}.`,
      status: 400,
    };
  }

  return { ok: true, value: connection.id };
}

export async function POST(request: Request, { params }: Params) {
  return withTenant(async (repos) => {
    const { id: dashboardId } = await params;
    if (!(await repos.dashboards.get(dashboardId))) {
      return jsonError("Dashboard not found", 404);
    }

    const body = await request.json().catch(() => null);
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid widget payload");

    const def = getWidgetDefinition(parsed.data.widgetType);
    if (!def) return jsonError("Unknown widget type");

    const denied = await overLimit(
      repos,
      "widgetsPerDashboard",
      await repos.widgets.countFor(dashboardId),
    );
    if (denied) return denied;

    const connection = await resolveConnection(
      repos,
      def.type,
      parsed.data.connectionId,
    );
    if (!connection.ok) return jsonError(connection.error, connection.status);

    /*
     * A cross-source widget is created with its connection set written out.
     *
     * "Every connection this organization has" is an implicit grant, and the
     * moment the dashboard is shared that grant reaches someone who was only
     * given one canvas. Recording the set at creation keeps the default
     * behaviour identical while making it something the owner can see and
     * trim — and something a share link can be held to.
     */
    const config = parseWidgetConfig(parsed.data.config);
    if (isMultiSource(def.type) && config.connectionIds === undefined) {
      config.connectionIds = (await repos.connections.list()).map((c) => c.id);
    }

    const row = await repos.widgets.add({
      dashboardId,
      widgetType: def.type,
      title: parsed.data.title || def.name,
      configJson: JSON.stringify(config),
      connectionId: connection.value,
      layoutY: await repos.widgets.nextY(dashboardId),
      layoutW: def.defaultW,
      layoutH: def.defaultH,
    });

    return jsonOk({ widget: toCanvasWidget(row) }, { status: 201 });
  });
}

const layoutSchema = z.object({
  layouts: z.array(
    z.object({
      i: z.string(),
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      w: z.number().int().min(1),
      h: z.number().int().min(1),
    }),
  ),
});

export async function PUT(request: Request, { params }: Params) {
  return withTenant(async (repos) => {
    const { id: dashboardId } = await params;
    if (!(await repos.dashboards.get(dashboardId))) {
      return jsonError("Dashboard not found", 404);
    }

    const body = await request.json().catch(() => null);
    const parsed = layoutSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid layout payload");

    const updated = await repos.widgets.saveLayouts(
      dashboardId,
      parsed.data.layouts,
    );
    return jsonOk({ ok: true, updated });
  });
}

const patchSchema = z.object({
  widgetId: z.string(),
  /** An empty string clears a custom title back to the registry name. */
  title: z.string().max(120).nullable().optional(),
  /** Null pins the widget back to the provider's default connection. */
  connectionId: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Change what an existing widget shows.
 *
 * Separate from PUT, which is the layout write the canvas fires on every drag:
 * settings changes are rare and deliberate, and folding them into the same
 * endpoint would mean a dropped drag could revert someone's configuration.
 */
export async function PATCH(request: Request, { params }: Params) {
  return withTenant(async (repos) => {
    const { id: dashboardId } = await params;
    if (!(await repos.dashboards.get(dashboardId))) {
      return jsonError("Dashboard not found", 404);
    }

    const body = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid widget payload");

    const existing = await repos.widgets.get(dashboardId, parsed.data.widgetId);
    if (!existing) return jsonError("Widget not found", 404);

    const patch: {
      title?: string | null;
      connectionId?: string | null;
      configJson?: string;
    } = {};

    if ("title" in parsed.data) {
      const title = parsed.data.title?.trim();
      patch.title = title || getWidgetDefinition(existing.widgetType)?.name || null;
    }

    if ("connectionId" in parsed.data) {
      const connection = await resolveConnection(
        repos,
        existing.widgetType,
        parsed.data.connectionId,
      );
      if (!connection.ok) return jsonError(connection.error, connection.status);
      patch.connectionId = connection.value;
    }

    if (parsed.data.config) {
      patch.configJson = JSON.stringify(parseWidgetConfig(parsed.data.config));
    }

    const row = await repos.widgets.update(
      dashboardId,
      parsed.data.widgetId,
      patch,
    );
    if (!row) return jsonError("Widget not found", 404);

    return jsonOk({ widget: toCanvasWidget(row) });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withTenant(async (repos) => {
    const { id: dashboardId } = await params;
    const { searchParams } = new URL(request.url);
    const widgetId = searchParams.get("widgetId");
    if (!widgetId) return jsonError("widgetId required");

    const removed = await repos.widgets.remove(dashboardId, widgetId);
    if (!removed) return jsonError("Widget not found", 404);
    return jsonOk({ ok: true });
  });
}
