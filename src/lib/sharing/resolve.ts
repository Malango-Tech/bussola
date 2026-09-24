import { and, eq, isNull, or, gt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dashboardShares, dashboards } from "@/lib/db/schema";
import { forTenant, type TenantRepos } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { hashToken, looksLikeToken } from "./tokens";

const log = logger("share");

/**
 * Turn a share token into a tenant, the same way `lib/auth/tenant.ts` turns a
 * session cookie into one.
 *
 * This is the only place a request with no account reaches tenant data, and it
 * is deliberately shaped like the authenticated path: it produces the same
 * organization-scoped repositories, so every query a shared page makes is
 * filtered by organization exactly as a signed-in one is. The token decides
 * *which* organization; it never widens what can be read within it.
 *
 * Route handlers may not import the database directly, which is why the lookup
 * lives here rather than inline in `/share/[token]`.
 */
export type ResolvedShare = {
  shareId: string;
  organizationId: string;
  dashboardId: string;
  dashboardName: string;
  whiteLabel: boolean;
  /** Repositories bound to the share's organization. */
  repos: TenantRepos;
};

/**
 * A share link grants no user identity.
 *
 * The repositories still want a `userId` — it is what stamps "created by" on
 * anything written — so the viewer is given one that is not a user id and
 * cannot collide with one. Nothing a shared page can reach writes, so this is
 * belt and braces rather than load-bearing.
 */
const ANONYMOUS_VIEWER = "share-viewer";

export async function resolveShare(
  token: string,
): Promise<ResolvedShare | null> {
  if (!looksLikeToken(token)) return null;

  const db = await getDb();
  const now = new Date();

  const [row] = await db
    .select({
      shareId: dashboardShares.id,
      organizationId: dashboardShares.organizationId,
      dashboardId: dashboardShares.dashboardId,
      dashboardName: dashboards.name,
      whiteLabel: dashboardShares.whiteLabel,
    })
    .from(dashboardShares)
    .innerJoin(dashboards, eq(dashboardShares.dashboardId, dashboards.id))
    .where(
      and(
        eq(dashboardShares.tokenHash, hashToken(token)),
        isNull(dashboardShares.revokedAt),
        // An unset expiry means "until revoked".
        or(
          isNull(dashboardShares.expiresAt),
          gt(dashboardShares.expiresAt, now),
        ),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    ...row,
    repos: forTenant({
      organizationId: row.organizationId,
      userId: ANONYMOUS_VIEWER,
    }),
  };
}

/**
 * Count a view.
 *
 * Incremented in SQL rather than read-modify-written, so two people opening a
 * link at once are two views. Failures are swallowed: a counter is not worth
 * failing a page render over.
 */
export async function recordShareView(shareId: string): Promise<void> {
  try {
    const db = await getDb();
    await db
      .update(dashboardShares)
      .set({
        viewCount: sql`${dashboardShares.viewCount} + 1`,
        lastViewedAt: new Date(),
      })
      .where(eq(dashboardShares.id, shareId));
  } catch (error) {
    log.warn("could not record a view", { shareId }, error);
  }
}
