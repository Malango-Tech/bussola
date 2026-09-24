import { and, count, desc, eq } from "drizzle-orm";
import { createId } from "@/lib/id";
import { getDb } from "..";
import { alertRules, connections, type AlertComparator } from "../schema";
import type { TenantContext } from "./context";

/**
 * Upper bound on the rules management list.
 *
 * No plan caps how many rules an organization keeps, so unlike dashboards the
 * list has nothing else stopping it growing. Several hundred rules is already
 * past what the screen can usefully show; newest are kept.
 */
const MAX_RULES_LISTED = 500;

export function alertRulesRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  const ownRule = (id: string) =>
    and(eq(alertRules.id, id), eq(alertRules.organizationId, org));

  return {
    /** Rules with the connection they watch, for the management screen. */
    async list() {
      const db = await getDb();
      return db
        .select({
          id: alertRules.id,
          connectionId: alertRules.connectionId,
          metric: alertRules.metric,
          comparator: alertRules.comparator,
          threshold: alertRules.threshold,
          channelIdsJson: alertRules.channelIdsJson,
          enabled: alertRules.enabled,
          cooldownMinutes: alertRules.cooldownMinutes,
          lastState: alertRules.lastState,
          lastValue: alertRules.lastValue,
          lastEvaluatedAt: alertRules.lastEvaluatedAt,
          lastNotifiedAt: alertRules.lastNotifiedAt,
          mutedUntil: alertRules.mutedUntil,
          createdAt: alertRules.createdAt,
          provider: connections.provider,
          connectionLabel: connections.label,
        })
        .from(alertRules)
        .innerJoin(connections, eq(alertRules.connectionId, connections.id))
        .where(eq(alertRules.organizationId, org))
        .orderBy(desc(alertRules.createdAt))
        .limit(MAX_RULES_LISTED);
    },

    async count() {
      const db = await getDb();
      const [row] = await db
        .select({ value: count() })
        .from(alertRules)
        .where(eq(alertRules.organizationId, org));
      return row?.value ?? 0;
    },

    async get(id: string) {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(alertRules)
        .where(ownRule(id))
        .limit(1);
      return row ?? null;
    },

    async create(input: {
      connectionId: string;
      metric: string;
      comparator: AlertComparator;
      threshold: string;
      channelIds: string[];
      cooldownMinutes: number;
    }) {
      const db = await getDb();
      const [row] = await db
        .insert(alertRules)
        .values({
          id: createId("alr"),
          organizationId: org,
          connectionId: input.connectionId,
          metric: input.metric,
          comparator: input.comparator,
          threshold: input.threshold,
          channelIdsJson: JSON.stringify(input.channelIds),
          cooldownMinutes: input.cooldownMinutes,
          createdBy: ctx.userId,
        })
        .returning();
      return row;
    },

    async update(
      id: string,
      input: {
        comparator?: AlertComparator;
        threshold?: string;
        channelIds?: string[];
        enabled?: boolean;
        cooldownMinutes?: number;
        mutedUntil?: Date | null;
      },
    ) {
      const db = await getDb();
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.comparator !== undefined) patch.comparator = input.comparator;
      if (input.threshold !== undefined) {
        patch.threshold = input.threshold;
        // A new threshold describes a different question, so the old verdict
        // must not suppress the first notification under the new one.
        patch.lastState = null;
      }
      if (input.channelIds !== undefined) {
        patch.channelIdsJson = JSON.stringify(input.channelIds);
      }
      if (input.enabled !== undefined) patch.enabled = input.enabled;
      if (input.cooldownMinutes !== undefined) {
        patch.cooldownMinutes = input.cooldownMinutes;
      }
      if ("mutedUntil" in input) patch.mutedUntil = input.mutedUntil;

      const [row] = await db
        .update(alertRules)
        .set(patch)
        .where(ownRule(id))
        .returning();
      return row ?? null;
    },

    async remove(id: string) {
      const db = await getDb();
      const rows = await db
        .delete(alertRules)
        .where(ownRule(id))
        .returning({ id: alertRules.id });
      return rows.length > 0;
    },
  };
}
