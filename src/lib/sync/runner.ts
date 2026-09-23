import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { connectionSnapshots, connections } from "@/lib/db/schema";
import { evaluateAlertsForConnection } from "@/lib/alerts/runner";
import { parseCredentials } from "@/lib/connectors";
import { toUserFacingError } from "@/lib/connectors/errors";
import { createId } from "@/lib/id";
import type { Provider } from "@/lib/providers";
import {
  batchSize,
  CLAIM_LEASE_SECONDS,
  DASHBOARD_KIND,
  MAX_CONSECUTIVE_FAILURES,
  PAYLOAD_VERSION,
  PAYLOAD_VERSION_KEY,
  nextDelaySeconds,
} from "./config";
import { fetchDashboardSnapshot, isSyncable } from "./providers";
import { recordHistory } from "./retention";

export type SyncOutcome = {
  connectionId: string;
  provider: string;
  ok: boolean;
  error?: string;
  disabled?: boolean;
};

export type SyncReport = {
  claimed: number;
  succeeded: number;
  failed: number;
  disabled: number;
  outcomes: SyncOutcome[];
};

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

/**
 * Atomically take ownership of up to `limit` connections that are due.
 *
 * The claim is the `next_sync_at` push itself: `FOR UPDATE SKIP LOCKED` means
 * concurrent workers select disjoint rows, and moving the timestamp a lease
 * into the future stops a second tick from picking the same row up while the
 * first is still fetching. A worker that crashes mid-fetch loses nothing — its
 * rows simply become due again when the lease expires.
 */
async function claimDue(limit: number) {
  const db = await getDb();
  const now = new Date();

  const due = db
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(eq(connections.syncEnabled, true), lte(connections.nextSyncAt, now)),
    )
    .orderBy(asc(connections.nextSyncAt))
    .limit(limit)
    .for("update", { skipLocked: true });

  return db
    .update(connections)
    .set({ nextSyncAt: secondsFromNow(CLAIM_LEASE_SECONDS) })
    .where(inArray(connections.id, due))
    .returning({
      id: connections.id,
      organizationId: connections.organizationId,
      provider: connections.provider,
      credentialsEncrypted: connections.credentialsEncrypted,
      consecutiveFailures: connections.consecutiveFailures,
    });
}

async function storeSnapshot(input: {
  organizationId: string;
  connectionId: string;
  payload: unknown;
}) {
  const db = await getDb();
  const payloadJson = JSON.stringify(input.payload);
  const fetchedAt = new Date();

  await db
    .insert(connectionSnapshots)
    .values({
      id: createId("snp"),
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      kind: DASHBOARD_KIND,
      payloadJson,
      fetchedAt,
    })
    .onConflictDoUpdate({
      target: [connectionSnapshots.connectionId, connectionSnapshots.kind],
      set: { payloadJson, fetchedAt },
    });
}

async function recordSuccess(connectionId: string, provider: Provider) {
  const db = await getDb();
  const now = new Date();
  await db
    .update(connections)
    .set({
      status: "connected",
      lastError: null,
      lastCheckedAt: now,
      lastSyncedAt: now,
      consecutiveFailures: 0,
      nextSyncAt: secondsFromNow(nextDelaySeconds(provider, 0)),
      updatedAt: now,
    })
    .where(eq(connections.id, connectionId));
}

async function recordFailure(
  connectionId: string,
  provider: Provider,
  error: unknown,
): Promise<{ message: string; disabled: boolean }> {
  const db = await getDb();
  const now = new Date();
  const message = toUserFacingError(error, provider);

  // Increment in SQL so concurrent workers cannot clobber the count.
  const [row] = await db
    .update(connections)
    .set({
      status: "error",
      lastError: message,
      lastCheckedAt: now,
      consecutiveFailures: sql`${connections.consecutiveFailures} + 1`,
      updatedAt: now,
    })
    .where(eq(connections.id, connectionId))
    .returning({ failures: connections.consecutiveFailures });

  const failures = row?.failures ?? 1;
  const disabled = failures >= MAX_CONSECUTIVE_FAILURES;

  await db
    .update(connections)
    .set({
      nextSyncAt: secondsFromNow(nextDelaySeconds(provider, failures)),
      syncEnabled: !disabled,
    })
    .where(eq(connections.id, connectionId));

  return { message, disabled };
}

/**
 * Record which connector shape produced this payload, so a reader can tell a
 * snapshot written before a field existed from one where the field is empty.
 */
function stampVersion(payload: unknown, provider: Provider): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  return { ...payload, [PAYLOAD_VERSION_KEY]: PAYLOAD_VERSION[provider] };
}

/** Fetch and store one connection's snapshot, recording the outcome. */
export async function syncConnection(connection: {
  id: string;
  organizationId: string;
  provider: string;
  credentialsEncrypted: string;
}): Promise<SyncOutcome> {
  const { id, provider } = connection;

  if (!isSyncable(provider)) {
    // Nothing can fetch this provider yet; stop scheduling it.
    const db = await getDb();
    await db
      .update(connections)
      .set({ syncEnabled: false })
      .where(eq(connections.id, id));
    return { connectionId: id, provider, ok: false, disabled: true };
  }

  try {
    const credentials = parseCredentials(connection.credentialsEncrypted);
    const payload = stampVersion(
      await fetchDashboardSnapshot(provider, credentials),
      provider,
    );
    await storeSnapshot({
      organizationId: connection.organizationId,
      connectionId: id,
      payload,
    });
    await recordHistory({
      organizationId: connection.organizationId,
      connectionId: id,
      kind: DASHBOARD_KIND,
      payload,
    });
    await recordSuccess(id, provider);

    /*
     * Alerts are evaluated here rather than on a timer of their own: a metric
     * can only change when a snapshot does, so this is both the earliest a
     * rule could fire and the only moment there is anything new to read.
     *
     * It never throws — `evaluateAlertsForConnection` swallows and logs — so a
     * broken rule or a dead webhook cannot turn a successful sync into a
     * failed one, which would then back the connection off and eventually
     * disable it.
     */
    await evaluateAlertsForConnection({
      connectionId: id,
      organizationId: connection.organizationId,
    });

    return { connectionId: id, provider, ok: true };
  } catch (error) {
    const { message, disabled } = await recordFailure(id, provider, error);
    // The user-facing message is stored on the connection, but without this the
    // only trace of *why* a sync failed is a "failed=1" count in the tick log.
    console.warn(
      `[sync] ${provider} failed${disabled ? " (now disabled)" : ""}: ${message}`,
      error instanceof Error ? error.message : error,
    );
    return { connectionId: id, provider, ok: false, error: message, disabled };
  }
}

/**
 * One scheduler tick: claim what is due and sync it.
 *
 * Connections are synced concurrently but the batch is bounded, so a tenant
 * with many connections cannot starve the queue or open unbounded sockets.
 */
export async function runDueSyncs(limit = batchSize()): Promise<SyncReport> {
  const claimed = await claimDue(limit);
  const outcomes = await Promise.all(claimed.map(syncConnection));

  return {
    claimed: claimed.length,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    disabled: outcomes.filter((o) => o.disabled).length,
    outcomes,
  };
}

/**
 * Sync one connection immediately, ignoring its schedule.
 *
 * Used when a connection is created or re-tested, so its widgets have data
 * without waiting for the next tick.
 */
export async function syncNow(connectionId: string): Promise<SyncOutcome | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: connections.id,
      organizationId: connections.organizationId,
      provider: connections.provider,
      credentialsEncrypted: connections.credentialsEncrypted,
    })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);

  return row ? syncConnection(row) : null;
}
