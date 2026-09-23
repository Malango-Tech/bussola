import { and, count, desc, eq } from "drizzle-orm";
import { createId } from "@/lib/id";
import { getDb } from "..";
import { dashboards } from "../schema";
import type { TenantContext } from "./context";

export function dashboardsRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  /** Reused by every dashboard query so the scope cannot be omitted. */
  const ownDashboard = (id: string) =>
    and(eq(dashboards.id, id), eq(dashboards.organizationId, org));

  return {
    async list() {
      const db = await getDb();
      return db
        .select()
        .from(dashboards)
        .where(eq(dashboards.organizationId, org))
        .orderBy(desc(dashboards.updatedAt));
    },

    async get(id: string) {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(dashboards)
        .where(ownDashboard(id))
        .limit(1);
      return row ?? null;
    },

    async count() {
      const db = await getDb();
      const [row] = await db
        .select({ value: count() })
        .from(dashboards)
        .where(eq(dashboards.organizationId, org));
      return row?.value ?? 0;
    },

    /** For the sidebar's persistent shortcuts. */
    async listStarred() {
      const db = await getDb();
      return db
        .select()
        .from(dashboards)
        .where(and(eq(dashboards.organizationId, org), eq(dashboards.starred, true)))
        .orderBy(desc(dashboards.updatedAt));
    },

    async create(name: string) {
      const db = await getDb();
      const [row] = await db
        .insert(dashboards)
        .values({ id: createId("dash"), organizationId: org, name })
        .returning();
      return row;
    },

    async rename(id: string, name: string) {
      const db = await getDb();
      const [row] = await db
        .update(dashboards)
        .set({ name, updatedAt: new Date() })
        .where(ownDashboard(id))
        .returning();
      return row ?? null;
    },

    async star(id: string, starred: boolean) {
      const db = await getDb();
      const [row] = await db
        .update(dashboards)
        .set({ starred })
        .where(ownDashboard(id))
        .returning();
      return row ?? null;
    },

    async remove(id: string) {
      const db = await getDb();
      const rows = await db
        .delete(dashboards)
        .where(ownDashboard(id))
        .returning({ id: dashboards.id });
      return rows.length > 0;
    },
  };
}
