import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { createId } from "@/lib/id";
import { getDb } from "..";
import { dashboardShares } from "../schema";
import type { TenantContext } from "./context";

/** Links listed per dashboard; see `listFor`. */
export const MAX_SHARES_LISTED = 100;

export function sharesRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  return {
    /**
     * A dashboard's links, newest first.
     *
     * Bounded, because revoked links are kept (see `revoke`) and so the list
     * only ever grows. Live links are chosen ahead of revoked ones before the
     * bound applies — an old link still in circulation must never fall off the
     * list its owner would revoke it from — and the page is then put back in
     * creation order.
     */
    async listFor(dashboardId: string) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(dashboardShares)
        .where(
          and(
            eq(dashboardShares.dashboardId, dashboardId),
            eq(dashboardShares.organizationId, org),
          ),
        )
        .orderBy(
          sql`${dashboardShares.revokedAt} is null desc`,
          desc(dashboardShares.createdAt),
        )
        .limit(MAX_SHARES_LISTED);
      return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    /** Live links across every dashboard, for the count in settings. */
    async countActive() {
      const db = await getDb();
      const [row] = await db
        .select({ value: count() })
        .from(dashboardShares)
        .where(
          and(
            eq(dashboardShares.organizationId, org),
            isNull(dashboardShares.revokedAt),
          ),
        );
      return row?.value ?? 0;
    },

    async create(input: {
      dashboardId: string;
      tokenHash: string;
      tokenPrefix: string;
      label: string | null;
      whiteLabel: boolean;
      expiresAt: Date | null;
    }) {
      const db = await getDb();
      const [row] = await db
        .insert(dashboardShares)
        .values({
          id: createId("shr"),
          organizationId: org,
          dashboardId: input.dashboardId,
          tokenHash: input.tokenHash,
          tokenPrefix: input.tokenPrefix,
          label: input.label,
          whiteLabel: input.whiteLabel,
          expiresAt: input.expiresAt,
          createdBy: ctx.userId,
        })
        .returning();
      return row;
    },

    /**
     * Revoking is a timestamp, not a delete: the row is what says a link
     * *was* live and how often it was opened, which is exactly what someone
     * wants to know at the moment they revoke it.
     */
    async revoke(id: string) {
      const db = await getDb();
      const [row] = await db
        .update(dashboardShares)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(dashboardShares.id, id),
            eq(dashboardShares.organizationId, org),
            isNull(dashboardShares.revokedAt),
          ),
        )
        .returning();
      return row ?? null;
    },
  };
}
