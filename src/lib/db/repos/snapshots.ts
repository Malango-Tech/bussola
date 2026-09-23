import { and, asc, eq } from "drizzle-orm";
import { getDb } from "..";
import { connectionSnapshots, connections, type Provider } from "../schema";

/**
 * Snapshot reads, by provider or by connection.
 *
 * Split into its own factory because the alert evaluator needs it outside a
 * request — there is no session behind a worker tick — while still going
 * through the same organization filter as everything else. That is also why
 * it takes a bare organization id rather than a full `TenantContext`.
 */
export function snapshotRepo(org: string) {
  const shape = {
    payloadJson: connectionSnapshots.payloadJson,
    fetchedAt: connectionSnapshots.fetchedAt,
    connectionId: connections.id,
    connectionLabel: connections.label,
    provider: connections.provider,
    syncEnabled: connections.syncEnabled,
    lastError: connections.lastError,
    consecutiveFailures: connections.consecutiveFailures,
  };

  type Row = {
    payloadJson: string | null;
    fetchedAt: Date | null;
    connectionId: string;
    connectionLabel: string;
    provider: Provider;
    syncEnabled: boolean;
    lastError: string | null;
    consecutiveFailures: number;
  };

  const hydrate = (row: Row) => ({
    connectionId: row.connectionId,
    connectionLabel: row.connectionLabel,
    provider: row.provider,
    payload: row.payloadJson
      ? (JSON.parse(row.payloadJson) as Record<string, unknown>)
      : null,
    fetchedAt: row.fetchedAt,
    syncEnabled: row.syncEnabled,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
  });

  /**
   * Snapshots are left-joined so a connection with no payload yet still
   * resolves — a source connected seconds ago must read as "connected, no data
   * yet" rather than as not connected at all.
   *
   * Boxed in an object because `await` unwraps thenables recursively, and a
   * Drizzle query builder is thenable: returning one straight out of an async
   * function would run the query at the `await` instead of handing back
   * something still open to `.where()`.
   */
  const base = async () => {
    const db = await getDb();
    return {
      query: db
        .select(shape)
        .from(connections)
        .leftJoin(
          connectionSnapshots,
          and(
            eq(connectionSnapshots.connectionId, connections.id),
            eq(connectionSnapshots.kind, "dashboard"),
          ),
        ),
    };
  };

  return {
    /**
     * The default connection's snapshot for a provider: the oldest one, which
     * is what a widget with no explicit connection has always read.
     */
    async forProvider(provider: Provider) {
      const { query } = await base();
      const [row] = await query
        .where(
          and(
            eq(connections.provider, provider),
            eq(connections.organizationId, org),
          ),
        )
        .orderBy(asc(connections.createdAt))
        .limit(1);
      return row ? hydrate(row) : null;
    },

    /** One specific connection, when a widget names it. */
    async forConnection(connectionId: string) {
      const { query } = await base();
      const [row] = await query
        .where(
          and(
            eq(connections.id, connectionId),
            eq(connections.organizationId, org),
          ),
        )
        .limit(1);
      return row ? hydrate(row) : null;
    },

    /** Every connection's snapshot, for cross-source widgets. */
    async listAll() {
      const { query } = await base();
      const rows = await query
        .where(eq(connections.organizationId, org))
        .orderBy(asc(connections.createdAt));
      return rows.map(hydrate);
    },
  };
}

export type SnapshotRepo = ReturnType<typeof snapshotRepo>;
export type ConnectionSnapshotView = NonNullable<
  Awaited<ReturnType<SnapshotRepo["forProvider"]>>
>;
