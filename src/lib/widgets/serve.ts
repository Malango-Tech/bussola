import { fetchQontoTransactionsPage, parseCredentials } from "@/lib/connectors";
import { toUserFacingError } from "@/lib/connectors/errors";
import type { TenantRepos } from "@/lib/db/tenant";
import { demoTransactions } from "@/lib/demo/fixtures";
import type { Provider } from "@/lib/providers";
import {
  PAYLOAD_VERSION,
  PAYLOAD_VERSION_KEY,
  SYNC_INTERVAL_SECONDS,
} from "@/lib/sync/config";
import { syncNow } from "@/lib/sync/runner";
import {
  isLemonSqueezyWidget,
  isNetlifyWidget,
  isQontoWidget,
  isRailwayWidget,
  isResendWidget,
  isSentryWidget,
  isStripeWidget,
  isSupabaseWidget,
  isVercelWidget,
  type WidgetType,
} from "@/lib/widgets/registry";
import { demoPayload } from "@/lib/widgets/demo";

/**
 * Serving widget data, independent of who is asking.
 *
 * Two routes reach this: `/api/widgets/data` for a signed-in session, and
 * `/api/share/[token]/data` for a read-only link. Both hand in repositories
 * already bound to one organization, so the difference between them is how the
 * caller was identified — never what the query is allowed to see. Keeping one
 * implementation is what stops a shared dashboard from drifting into showing
 * more, or less, than the same dashboard shows its owner.
 */

export type WidgetDataResult = {
  status: number;
  body: Record<string, unknown>;
};

const ok = (body: Record<string, unknown>): WidgetDataResult => ({
  status: 200,
  body,
});

const fail = (message: string, status = 400): WidgetDataResult => ({
  status,
  body: { error: message },
});

/** A snapshot older than this many intervals is reported as stale. */
const STALE_AFTER_INTERVALS = 3;

/** Transactions are paginated and read straight through, so keep a short TTL. */
const TRANSACTIONS_TTL_SECONDS = 30;

/** How long a failed shape-upgrade re-sync waits before being retried. */
const RESYNC_BACKOFF_SECONDS = 120;

/**
 * What a widget shows before its source is connected.
 *
 * A grid of empty boxes makes a new account look broken rather than new, so an
 * unconnected provider renders sample data instead — the same components, the
 * same shapes, plausible numbers. `_demo` is what makes it unmistakable: the
 * frame labels it and links to Connections, so nobody reads these as their own
 * figures. Providers without fixtures fall back to the empty state.
 */
function notConnected(provider: Provider | "multi") {
  const demo = demoPayload(provider);

  if (demo) {
    return ok(demo);
  }

  return ok({
    needsConnection: true,
    provider,
    items: [],
    trackers: {},
    balances: [],
    transactions: [],
    healthy: 0,
    total: 0,
  });
}

/**
 * Whether a stored payload predates the connector that reads it.
 *
 * Widgets read fields straight off the snapshot, so one written before a field
 * existed renders as an empty widget rather than an out-of-date one — the same
 * thing a genuinely empty account looks like. Refetching once on read is
 * cheaper than leaving someone to wonder why a new widget never fills in.
 */
function isOutdated(
  payload: Record<string, unknown>,
  provider: Provider,
): boolean {
  return payload[PAYLOAD_VERSION_KEY] !== PAYLOAD_VERSION[provider];
}

/**
 * Take the right to re-sync an out-of-date snapshot, at most once per interval.
 *
 * The claim is taken before the fetch, not after, so a provider that is down
 * cannot be retried on every poll: without that, an upgrade landing during an
 * outage would burn through the consecutive-failure budget and disable the
 * connection outright. Backing off to the provider's own interval means a
 * failed refresh costs no more than a scheduled one.
 */
async function claimResync(
  repos: TenantRepos,
  snapshot: { connectionId: string },
): Promise<boolean> {
  const key = `resync:${snapshot.connectionId}`;
  if (await repos.cache.get(key)) return false;
  await repos.cache.set(key, true, RESYNC_BACKOFF_SECONDS);
  return true;
}

/**
 * Serve a provider's dashboard from the snapshot the sync worker stored.
 *
 * `connectionId` is how a widget names one account when the organization has
 * several. Without it the default connection answers — the oldest one, which
 * is what every widget meant before a second account of the same provider was
 * possible, so existing canvases keep showing exactly what they showed.
 *
 * A named connection that no longer exists is not silently replaced by the
 * default: two Stripe accounts answering for each other is worse than a widget
 * saying it has lost its source.
 *
 * This request never calls a provider — with one exception. A connection that
 * has just been added has no snapshot yet, and waiting for the next worker tick
 * would leave the user staring at a spinner, so the first read after connecting
 * syncs inline. Every read after that is a single local query, which is what
 * decouples upstream traffic from the number of people looking at dashboards.
 */
async function serveDashboard(
  repos: TenantRepos,
  provider: Provider,
  connectionId?: string | null,
) {
  const read = () =>
    connectionId
      ? repos.snapshots.forConnection(connectionId)
      : repos.snapshots.forProvider(provider);

  let snapshot = await read();

  if (!snapshot) {
    if (connectionId) {
      return fail(
        "This widget's source has been removed. Pick another in widget settings.",
        404,
      );
    }
    return notConnected(provider);
  }

  if (snapshot.provider !== provider) {
    return fail(
      "This widget's source is a different provider now. Pick another in widget settings.",
      409,
    );
  }

  const outdated = snapshot.payload
    ? isOutdated(snapshot.payload, provider)
    : false;

  if (!snapshot.payload || (outdated && (await claimResync(repos, snapshot)))) {
    await syncNow(snapshot.connectionId);
    snapshot = await read();
  }

  if (!snapshot?.payload) {
    return fail(
      snapshot?.lastError || "Could not load data for this source.",
      502,
    );
  }

  const intervalMs = (SYNC_INTERVAL_SECONDS[provider] ?? 120) * 1000;
  const ageMs = Date.now() - new Date(snapshot.fetchedAt!).getTime();

  return ok({
    ...snapshot.payload,
    _sync: {
      fetchedAt: snapshot.fetchedAt,
      stale: ageMs > intervalMs * STALE_AFTER_INTERVALS,
      // Sync gave up on this connection; the credentials likely need replacing.
      disabled: !snapshot.syncEnabled,
      lastError: snapshot.lastError,
      connectionId: snapshot.connectionId,
      connectionLabel: snapshot.connectionLabel,
    },
  });
}

export type WidgetDataRequest = {
  type: WidgetType;
  /** Which connection to read. Absent means the provider's default. */
  connectionId?: string | null;
  /**
   * Cross-source widgets only: the connections the widget is configured to
   * read. Absent means every connection this organization has.
   */
  connectionIds?: string[] | null;
  /**
   * A hard ceiling on which connections may be touched, whatever the widget
   * asks for.
   *
   * Set by the share route to the connections the shared dashboard actually
   * binds. It is a separate field from `connectionIds` on purpose: one is a
   * preference the owner set, the other is a boundary the caller cannot widen,
   * and collapsing them into one would make the boundary editable.
   */
  restrictToConnectionIds?: string[] | null;
  /** Qonto transactions only: page size and cursor. */
  limit?: number;
  cursor?: string | null;
};

export async function serveWidgetData(
  repos: TenantRepos,
  request: WidgetDataRequest,
): Promise<WidgetDataResult> {
  const { type, connectionId } = request;

  const restrict = request.restrictToConnectionIds
    ? new Set(request.restrictToConnectionIds)
    : null;

  // A named connection outside the ceiling is refused rather than quietly
  // swapped for one inside it.
  if (connectionId && restrict && !restrict.has(connectionId)) {
    return fail("That widget is not on this dashboard.", 403);
  }

  try {
    switch (type) {
      case "railway-tracker":
      case "railway-services":
      case "railway-fleet":
      case "railway-resources":
      case "railway-usage":
      case "railway-deploys":
      case "railway-projects":
      case "railway-billing":
      case "railway-cpu":
      case "railway-memory":
      case "railway-egress":
      case "railway-disk":
        return await serveDashboard(repos, "railway", connectionId);

      case "netlify-tracker":
      case "netlify-sites":
      case "netlify-health":
      case "netlify-deploys":
      case "netlify-builds":
      case "netlify-forms":
        return await serveDashboard(repos, "netlify", connectionId);

      case "supabase-health":
      case "supabase-projects":
      case "supabase-services":
      case "supabase-traffic":
      case "supabase-requests":
      case "supabase-advisors":
      case "supabase-advisor-issues":
        return await serveDashboard(repos, "supabase", connectionId);

      case "stripe-mrr":
      case "stripe-revenue":
      case "stripe-payments":
        return await serveDashboard(repos, "stripe", connectionId);

      case "lemonsqueezy-mrr":
      case "lemonsqueezy-revenue":
      case "lemonsqueezy-orders":
        return await serveDashboard(repos, "lemonsqueezy", connectionId);

      case "sentry-issues":
      case "sentry-recent":
      case "sentry-projects":
        return await serveDashboard(repos, "sentry", connectionId);

      case "resend-domains":
      case "resend-emails":
      case "resend-broadcasts":
      case "resend-delivery":
      case "resend-open-rate":
      case "resend-click-rate":
      case "resend-outcomes":
        return await serveDashboard(repos, "resend", connectionId);

      case "vercel-tracker":
      case "vercel-projects":
      case "vercel-deploys":
        return await serveDashboard(repos, "vercel", connectionId);

      case "qonto-balance":
      case "qonto-cashflow":
      case "qonto-in-out":
      case "qonto-liquidity":
      case "qonto-accounts":
      case "qonto-history":
        return await serveDashboard(repos, "qonto", connectionId);

      case "qonto-transactions": {
        // Cursor pagination cannot be snapshotted usefully — each page is a
        // distinct, user-driven request — so this one path still reads
        // through to Qonto, behind the per-tenant cache.
        const conn = connectionId
          ? await repos.connections.get(connectionId)
          : await repos.connections.byProvider("qonto");
        if (!conn || conn.provider !== "qonto") {
          if (connectionId) {
            return fail(
              "This widget's source has been removed. Pick another in widget settings.",
              404,
            );
          }
          return ok({ ...demoTransactions(), _demo: true });
        }

        const credentials = parseCredentials(conn.credentialsEncrypted);
        const limit =
          Number.isFinite(request.limit) && request.limit! > 0
            ? Math.min(request.limit!, 100)
            : 20;
        const cursor = request.cursor ?? null;

        const { data } = await repos.cache.fetch(
          `qonto-tx:${conn.id}:${cursor || "start"}:${limit}`,
          TRANSACTIONS_TTL_SECONDS,
          () => fetchQontoTransactionsPage(credentials, { cursor, limit }),
        );
        return ok(data);
      }

      case "status-board": {
        /*
         * Every connection, not a hardcoded three.
         *
         * The point of a cross-source board is that it is the one widget
         * that does not care which sources you happen to have — and with
         * several connections per provider it must show both Railway
         * accounts, not whichever came first.
         */
        const chosen = request.connectionIds
          ? new Set(request.connectionIds)
          : null;

        const snapshots = (await repos.snapshots.listAll()).filter(
          (snapshot) =>
            // What the widget asks for, then what the caller is allowed.
            (!chosen || chosen.has(snapshot.connectionId)) &&
            (!restrict || restrict.has(snapshot.connectionId)),
        );

        if (snapshots.length === 0) {
          // Distinguish "nothing connected" from "this board is pointed at
          // nothing": the first is an onboarding state, the second a setting.
          return chosen || restrict
            ? ok({ items: [], noSourcesSelected: true })
            : notConnected("multi");
        }

        const items = snapshots.flatMap((snapshot) => {
          const rows = snapshot.payload?.items;
          if (!Array.isArray(rows)) return [];
          // Capped per connection so one large account cannot crowd the
          // others off a board whose whole job is breadth.
          return rows.slice(0, 8).map((row) =>
            row && typeof row === "object"
              ? {
                  ...(row as Record<string, unknown>),
                  _source: snapshot.connectionLabel,
                  // Lets the browser honour a chosen connection set for the
                  // owner, where withholding rows server-side would break the
                  // one-request-per-provider batching for no benefit: the
                  // owner can already see all of them.
                  _connectionId: snapshot.connectionId,
                }
              : row,
          );
        });

        return ok({ items });
      }

      default: {
        const _exhaustive: never = type;
        return fail(`Unknown widget type: ${_exhaustive}`);
      }
    }
  } catch (error) {
    const provider = providerForWidget(type);
    return fail(toUserFacingError(error, provider), 502);
  }
}

/** Which provider a widget belongs to, for turning an error into its wording. */
function providerForWidget(type: WidgetType): Provider | undefined {
  if (isRailwayWidget(type)) return "railway";
  if (isNetlifyWidget(type)) return "netlify";
  if (isSupabaseWidget(type)) return "supabase";
  if (isQontoWidget(type)) return "qonto";
  if (isStripeWidget(type)) return "stripe";
  if (isLemonSqueezyWidget(type)) return "lemonsqueezy";
  if (isSentryWidget(type)) return "sentry";
  if (isResendWidget(type)) return "resend";
  if (isVercelWidget(type)) return "vercel";
  return undefined;
}
