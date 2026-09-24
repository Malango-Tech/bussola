import { METRICS } from "@/lib/alerts/metrics";
import {
  checkLimit as checkPlanLimit,
  entitlementsFor,
} from "@/lib/billing/entitlements";
import { logger } from "@/lib/log";
import { WIDGET_REGISTRY, getWidgetDefinition } from "@/lib/widgets/registry";
import { parseWidgetConfig } from "@/lib/widgets/config";
import { serveWidgetData } from "@/lib/widgets/serve";
import type { WidgetType } from "@/lib/widgets/registry";
import type { McpPrincipal } from "./auth";

const log = logger("mcp");

/**
 * What an agent can do with a Bussola organization.
 *
 * The boundary is written here rather than described in a prompt, because a
 * prompt is a request and this is a rule. Three things are absent by
 * construction, not by instruction:
 *
 *  - **No credential ever leaves.** No tool returns a token, and none accepts
 *    one. Connecting a source stays a thing a human does in the web UI, where
 *    the value is typed once and encrypted immediately.
 *  - **No write reaches a third party.** Everything writable here is Bussola's
 *    own furniture — dashboards and the widgets on them. Nothing restarts a
 *    service, resolves an issue or moves money, because no such tool exists.
 *  - **Read tokens cannot write.** Enforced at dispatch, on the token's scope,
 *    not on the agent's good behaviour.
 */

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  /** Write tools are refused outright to a read-scoped token. */
  mutates: boolean;
  inputSchema: Record<string, unknown>;
};

type Json = Record<string, unknown>;

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_connections",
    title: "List connected sources",
    description:
      "Every source this organization has connected, with its sync health. Never returns credentials.",
    mutates: false,
    inputSchema: NO_ARGS,
  },
  {
    name: "list_dashboards",
    title: "List dashboards",
    description: "Every dashboard, with how many widgets each holds.",
    mutates: false,
    inputSchema: NO_ARGS,
  },
  {
    name: "get_dashboard",
    title: "Read one dashboard",
    description:
      "One dashboard's widgets, including layout, source binding and per-widget options.",
    mutates: false,
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: { type: "string", description: "The dashboard's id." },
      },
      required: ["dashboardId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_widget_types",
    title: "List available widget types",
    description:
      "The catalog of widgets that can be added, with the provider each reads from.",
    mutates: false,
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          description: "Optional: only widgets for this provider.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_widget_data",
    title: "Read live data",
    description:
      "The current numbers behind a widget type, from the last snapshot the sync worker stored. Does not call the provider.",
    mutates: false,
    inputSchema: {
      type: "object",
      properties: {
        widgetType: {
          type: "string",
          description: "A type from list_widget_types, e.g. 'stripe-mrr'.",
        },
        connectionId: {
          type: "string",
          description:
            "Optional: which connection to read, when several exist for the provider.",
        },
      },
      required: ["widgetType"],
      additionalProperties: false,
    },
  },
  {
    name: "list_alerts",
    title: "List alert rules and recent alerts",
    description:
      "Configured alert rules with their current state, plus what has fired recently.",
    mutates: false,
    inputSchema: NO_ARGS,
  },
  {
    name: "list_alert_metrics",
    title: "List watchable metrics",
    description:
      "Every number an alert rule can watch, by provider, with its unit.",
    mutates: false,
    inputSchema: NO_ARGS,
  },
  {
    name: "create_dashboard",
    title: "Create a dashboard",
    description: "Create an empty dashboard. Subject to the plan's limit.",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What to call it." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "add_widget",
    title: "Add a widget",
    description:
      "Add a widget to a dashboard. Subject to the plan's per-dashboard limit.",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: { type: "string" },
        widgetType: { type: "string" },
        title: { type: "string", description: "Optional heading." },
        connectionId: {
          type: "string",
          description: "Optional: pin the widget to one connection.",
        },
      },
      required: ["dashboardId", "widgetType"],
      additionalProperties: false,
    },
  },
  {
    name: "move_widget",
    title: "Move or resize a widget",
    description: "Set a widget's position and size on the 12-column grid.",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: { type: "string" },
        widgetId: { type: "string" },
        x: { type: "number", description: "Column, 0–11." },
        y: { type: "number", description: "Row." },
        w: { type: "number", description: "Width in columns." },
        h: { type: "number", description: "Height in rows." },
      },
      required: ["dashboardId", "widgetId", "x", "y", "w", "h"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_widget",
    title: "Remove a widget",
    description: "Delete one widget from a dashboard.",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: { type: "string" },
        widgetId: { type: "string" },
      },
      required: ["dashboardId", "widgetId"],
      additionalProperties: false,
    },
  },
  {
    name: "rename_dashboard",
    title: "Rename a dashboard",
    description: "Change a dashboard's name.",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: { type: "string" },
        name: { type: "string" },
      },
      required: ["dashboardId", "name"],
      additionalProperties: false,
    },
  },
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export type ToolOutcome =
  | { ok: true; data: Json }
  | { ok: false; error: string };

export async function callTool(
  principal: McpPrincipal,
  name: string,
  args: Json,
): Promise<ToolOutcome> {
  const tool = BY_NAME.get(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };

  if (tool.mutates && principal.scope !== "write") {
    return {
      ok: false,
      error: `${name} changes data, and this token is read-only. Create a token with write scope to use it.`,
    };
  }

  const { repos } = principal;

  switch (name) {
    case "list_connections": {
      const rows = await repos.connections.list();
      return {
        ok: true,
        data: {
          connections: rows.map((row) => ({
            id: row.id,
            provider: row.provider,
            label: row.label,
            status: row.status,
            syncEnabled: row.syncEnabled,
            lastSyncedAt: row.lastSyncedAt,
            lastError: row.lastError,
            // Deliberately no credentials field, at any scope.
          })),
        },
      };
    }

    case "list_dashboards": {
      const [rows, widgetTypes] = await Promise.all([
        repos.dashboards.list(),
        repos.widgets.listTypesByDashboard(),
      ]);
      const counts = new Map<string, number>();
      for (const row of widgetTypes) {
        counts.set(row.dashboardId, (counts.get(row.dashboardId) ?? 0) + 1);
      }
      return {
        ok: true,
        data: {
          dashboards: rows.map((row) => ({
            id: row.id,
            name: row.name,
            starred: row.starred,
            widgetCount: counts.get(row.id) ?? 0,
            updatedAt: row.updatedAt,
          })),
        },
      };
    }

    case "get_dashboard": {
      const dashboardId = str(args.dashboardId);
      if (!dashboardId) return { ok: false, error: "dashboardId is required" };

      const dashboard = await repos.dashboards.get(dashboardId);
      if (!dashboard) return { ok: false, error: "Dashboard not found" };

      const widgets = await repos.widgets.listFor(dashboardId);
      return {
        ok: true,
        data: {
          dashboard: { id: dashboard.id, name: dashboard.name },
          widgets: widgets.map((widget) => ({
            id: widget.id,
            widgetType: widget.widgetType,
            title: widget.title,
            connectionId: widget.connectionId,
            config: parseWidgetConfig(safeJson(widget.configJson, widget.id)),
            layout: {
              x: widget.layoutX,
              y: widget.layoutY,
              w: widget.layoutW,
              h: widget.layoutH,
            },
          })),
        },
      };
    }

    case "list_widget_types": {
      const provider = str(args.provider);
      const rows = provider
        ? WIDGET_REGISTRY.filter((def) => def.provider === provider)
        : WIDGET_REGISTRY;
      return {
        ok: true,
        data: {
          widgetTypes: rows.map((def) => ({
            type: def.type,
            name: def.name,
            description: def.description,
            provider: def.provider,
            defaultSize: { w: def.defaultW, h: def.defaultH },
          })),
        },
      };
    }

    case "read_widget_data": {
      const widgetType = str(args.widgetType) as WidgetType | null;
      if (!widgetType || !getWidgetDefinition(widgetType)) {
        return { ok: false, error: "Unknown widgetType" };
      }

      const result = await serveWidgetData(repos, {
        type: widgetType,
        connectionId: str(args.connectionId),
      });

      if (result.status >= 400) {
        return { ok: false, error: String(result.body.error ?? "Failed to read") };
      }

      // Sample data is labelled rather than hidden: an agent asked to report
      // MRR must be able to tell a real figure from a placeholder.
      return {
        ok: true,
        data: {
          widgetType,
          isSampleData: result.body._demo === true,
          data: result.body,
        },
      };
    }

    case "list_alerts": {
      const [rules, events] = await Promise.all([
        repos.alertRules.list(),
        repos.alertEvents.list(25),
      ]);
      return {
        ok: true,
        data: {
          rules: rules.map((rule) => ({
            id: rule.id,
            provider: rule.provider,
            connectionLabel: rule.connectionLabel,
            metric: rule.metric,
            comparator: rule.comparator,
            threshold: rule.threshold,
            enabled: rule.enabled,
            state: rule.lastState,
            lastValue: rule.lastValue,
            lastEvaluatedAt: rule.lastEvaluatedAt,
          })),
          recent: events.map((event) => ({
            state: event.state,
            message: event.message,
            connectionLabel: event.connectionLabel,
            at: event.createdAt,
          })),
        },
      };
    }

    case "list_alert_metrics":
      return {
        ok: true,
        data: {
          metrics: METRICS.map((metric) => ({
            key: metric.key,
            provider: metric.provider,
            label: metric.label,
            description: metric.description,
            unit: metric.unit,
          })),
        },
      };

    case "create_dashboard": {
      const name = str(args.name);
      if (!name) return { ok: false, error: "name is required" };

      const limit = await checkLimit(repos, "dashboards");
      if (limit) return { ok: false, error: limit };

      const dashboard = await repos.dashboards.create(name.slice(0, 120));
      return { ok: true, data: { dashboard: { id: dashboard.id, name: dashboard.name } } };
    }

    case "rename_dashboard": {
      const dashboardId = str(args.dashboardId);
      const name = str(args.name);
      if (!dashboardId || !name) {
        return { ok: false, error: "dashboardId and name are required" };
      }
      const row = await repos.dashboards.rename(dashboardId, name.slice(0, 120));
      if (!row) return { ok: false, error: "Dashboard not found" };
      return { ok: true, data: { dashboard: { id: row.id, name: row.name } } };
    }

    case "add_widget": {
      const dashboardId = str(args.dashboardId);
      const widgetType = str(args.widgetType);
      if (!dashboardId || !widgetType) {
        return { ok: false, error: "dashboardId and widgetType are required" };
      }

      const dashboard = await repos.dashboards.get(dashboardId);
      if (!dashboard) return { ok: false, error: "Dashboard not found" };

      const def = getWidgetDefinition(widgetType);
      if (!def) return { ok: false, error: `Unknown widgetType: ${widgetType}` };

      const limit = await checkLimit(repos, "widgetsPerDashboard", dashboardId);
      if (limit) return { ok: false, error: limit };

      // Same provider check the web UI applies: a widget pinned to a
      // connection of another provider would render an empty box.
      const connectionId = str(args.connectionId);
      if (connectionId) {
        const connection = await repos.connections.get(connectionId);
        if (!connection) return { ok: false, error: "Connection not found" };
        if (def.provider !== "multi" && def.provider !== connection.provider) {
          return {
            ok: false,
            error: `${def.name} reads ${def.provider}, not ${connection.provider}.`,
          };
        }
      }

      const widget = await repos.widgets.add({
        dashboardId,
        widgetType: def.type,
        title: str(args.title)?.slice(0, 120) || def.name,
        configJson: "{}",
        connectionId: connectionId ?? null,
        layoutY: await repos.widgets.nextY(dashboardId),
        layoutW: def.defaultW,
        layoutH: def.defaultH,
      });

      return { ok: true, data: { widget: { id: widget.id, widgetType: widget.widgetType } } };
    }

    case "move_widget": {
      const dashboardId = str(args.dashboardId);
      const widgetId = str(args.widgetId);
      const layout = {
        x: int(args.x),
        y: int(args.y),
        w: int(args.w),
        h: int(args.h),
      };
      if (!dashboardId || !widgetId) {
        return { ok: false, error: "dashboardId and widgetId are required" };
      }
      if (Object.values(layout).some((value) => value === null)) {
        return { ok: false, error: "x, y, w and h must be numbers" };
      }

      const updated = await repos.widgets.saveLayouts(dashboardId, [
        {
          i: widgetId,
          x: clamp(layout.x!, 0, 11),
          y: Math.max(0, layout.y!),
          w: clamp(layout.w!, 1, 12),
          h: clamp(layout.h!, 1, 20),
        },
      ]);
      if (updated === 0) return { ok: false, error: "Widget not found" };
      return { ok: true, data: { moved: updated } };
    }

    case "remove_widget": {
      const dashboardId = str(args.dashboardId);
      const widgetId = str(args.widgetId);
      if (!dashboardId || !widgetId) {
        return { ok: false, error: "dashboardId and widgetId are required" };
      }
      const removed = await repos.widgets.remove(dashboardId, widgetId);
      if (!removed) return { ok: false, error: "Widget not found" };
      return { ok: true, data: { removed: true } };
    }

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

/**
 * Plan limits apply to an agent exactly as they do to a person.
 *
 * Returns the message to refuse with, or null to continue. Reusing the same
 * entitlement lookup as the web routes matters: an agent that could add a
 * twenty-first dashboard on a Team plan would make the limit meaningless.
 */
async function checkLimit(
  repos: McpPrincipal["repos"],
  limit: "dashboards" | "widgetsPerDashboard",
  dashboardId?: string,
): Promise<string | null> {
  const entitlements = await entitlementsFor(repos.ctx.organizationId);
  const current =
    limit === "dashboards"
      ? await repos.dashboards.count()
      : await repos.widgets.countFor(dashboardId!);

  const result = checkPlanLimit(entitlements, limit, current);
  return result.allowed ? null : result.message;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * A widget's stored options, or none. Unreadable options fall back to the
 * widget's defaults, which is what the canvas shows for it too — so this is a
 * debug line rather than a failed tool call.
 */
function safeJson(raw: string, widgetId: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch (error) {
    log.debug("widget config is not valid JSON; using defaults", {
      widgetId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}
