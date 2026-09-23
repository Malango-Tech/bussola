import { jsonError, jsonOk } from "@/lib/api";
import { drainDeliveries } from "@/lib/alerts/outbox";
import { env } from "@/lib/env";
import { hashToken, tokensMatch } from "@/lib/sharing/tokens";
import { runDueSyncs } from "@/lib/sync/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron entry point for the sync worker, for platforms that schedule an HTTP
 * request rather than run a process (Vercel Cron, Railway cron, GitHub
 * Actions).
 *
 * Guarded by a shared secret rather than a user session: there is no user
 * here. Without BUSSOLA_SYNC_SECRET set, the endpoint stays closed — an open
 * one would let anyone force provider traffic on every tenant at once.
 */
function authorized(request: Request): boolean {
  const expected = env().BUSSOLA_SYNC_SECRET;
  if (!expected) return false;

  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-sync-secret");

  // Compared as hashes in constant time: timing reveals neither how many
  // leading characters matched nor how long the secret is.
  return Boolean(header) && tokensMatch(hashToken(header!), hashToken(expected));
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return jsonError("Unauthorized", 401);
  }

  const report = await runDueSyncs();

  /*
   * Drain queued alert notifications too.
   *
   * A serverless deployment has no long-running scheduler, so this request is
   * the only thing that ever runs. Draining after the syncs — not inside them
   * — keeps a slow webhook off a connection's critical path while still
   * getting the message out on the same tick.
   */
  const drained = await drainDeliveries();

  return jsonOk({
    claimed: report.claimed,
    succeeded: report.succeeded,
    failed: report.failed,
    disabled: report.disabled,
    deliveries: drained,
  });
}
