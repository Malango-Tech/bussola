import { and, count, desc, eq, isNull } from "drizzle-orm";
import { createId } from "@/lib/id";
import { getDb } from "..";
import { dashboardShares } from "../schema";
import type { TenantContext } from "./context";

export function sharesRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  return {
    async listFor(dashboardId: string) {
      const db = await getDb();
      return db
        .select()
        .from(dashboardShares)
        .where(
          and(
            eq(dashboardShares.dashboardId, dashboardId),
            eq(dashboardShares.organizationId, org),
          ),
        )
        .orderBy(desc(dashboardShares.createdAt));
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
