import { and, count, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "..";
import { alertEvents, alertRules, connections } from "../schema";
import type { TenantContext } from "./context";

export function alertEventsRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  return {
    async list(limit = 50) {
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
        .limit(limit);
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
