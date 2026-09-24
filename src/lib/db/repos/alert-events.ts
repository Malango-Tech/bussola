import { and, count, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "..";
import { alertEvents, alertRules, connections } from "../schema";
import type { TenantContext } from "./context";

/**
 * The most events one read returns, whatever the caller asks for.
 *
 * Events are appended on every breach and recovery and never deleted, so this
 * table grows for as long as an organization exists. The feed route already
 * clamps its query parameter to the same number; enforcing it here bounds
 * every caller, not just the one that remembered to.
 */
export const MAX_ALERT_EVENTS_LISTED = 200;

export function alertEventsRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  return {
    async list(limit = 50) {
      const bounded = Math.min(
        Math.max(1, Math.trunc(limit) || 1),
        MAX_ALERT_EVENTS_LISTED,
      );
      const db = await getDb();
      return db
        .select({
          id: alertEvents.id,
          ruleId: alertEvents.ruleId,
          state: alertEvents.state,
          value: alertEvents.value,
          message: alertEvents.message,
          deliveriesJson: alertEvents.deliveriesJson,
          acknowledgedAt: alertEvents.acknowledgedAt,
          createdAt: alertEvents.createdAt,
          metric: alertRules.metric,
          provider: connections.provider,
          connectionLabel: connections.label,
        })
        .from(alertEvents)
        .innerJoin(alertRules, eq(alertEvents.ruleId, alertRules.id))
        .innerJoin(connections, eq(alertRules.connectionId, connections.id))
        .where(eq(alertEvents.organizationId, org))
        .orderBy(desc(alertEvents.createdAt))
        .limit(bounded);
    },

    /** Unacknowledged breaches — the number on the sidebar's Alerts item. */
    async unacknowledgedCount() {
      const db = await getDb();
      const [row] = await db
        .select({ value: count() })
        .from(alertEvents)
        .where(
          and(
            eq(alertEvents.organizationId, org),
            eq(alertEvents.state, "breached"),
            isNull(alertEvents.acknowledgedAt),
          ),
        );
      return row?.value ?? 0;
    },

    async acknowledge(id: string) {
      const db = await getDb();
      const [row] = await db
        .update(alertEvents)
        .set({ acknowledgedAt: new Date() })
        .where(
          and(eq(alertEvents.id, id), eq(alertEvents.organizationId, org)),
        )
        .returning();
      return row ?? null;
    },

    async acknowledgeAll() {
      const db = await getDb();
      const rows = await db
        .update(alertEvents)
        .set({ acknowledgedAt: new Date() })
        .where(
          and(
            eq(alertEvents.organizationId, org),
            isNull(alertEvents.acknowledgedAt),
          ),
        )
        .returning({ id: alertEvents.id });
      return rows.length;
    },
  };
}
