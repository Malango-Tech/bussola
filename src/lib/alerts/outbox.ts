import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, type BussolaTx } from "@/lib/db";
import { valuesTable } from "@/lib/db/batch";
import {
  alertDeliveries,
  alertEvents,
  notificationChannels,
  type AlertDeliveryStatus,
} from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto/vault";
import { createId } from "@/lib/id";
import { logger } from "@/lib/log";
import { deliver, type AlertNotification, type Delivery } from "./deliver";

const log = logger("alerts");

/**
 * The queue between "an alert fired" and "someone was told".
 *
 * Delivery used to run inside `syncConnection`. That put someone else's
 * latency on the critical path of a sync: a Slack webhook hanging for its full
 * ten-second timeout delayed the connection's next schedule and held its lease
 * the whole time. Evaluation is cheap and stays inline — it needs the snapshot
 * that was just written — but sending is queued here and drained separately.
 *
 * Not an in-process queue. The codebase already learned this once with the
 * read-through cache: an un-awaited background task is free to be frozen by a
 * serverless runtime the moment the response is sent, so the work silently
 * never happens. A row in Postgres survives the process that wrote it.
 */

/** Attempts before a delivery is abandoned. */
const MAX_ATTEMPTS = 5;

/** Deliveries claimed per drain. Bounded so one tick cannot run forever. */
const DRAIN_BATCH = 20;

/** How long a claimed row stays claimed if the worker dies mid-send. */
const CLAIM_LEASE_SECONDS = 120;

export type DrainReport = {
  attempted: number;
  sent: number;
  failed: number;
  abandoned: number;
};

const EMPTY: DrainReport = { attempted: 0, sent: 0, failed: 0, abandoned: 0 };

/**
 * Backoff between attempts: 30s, 2m, 8m, 32m.
 *
 * A webhook is usually either fine or gone. Retrying fast twice catches a
 * blip; stretching out after that stops a deleted webhook being retried every
 * tick for an hour.
 */
function backoffSeconds(attempts: number): number {
  return 30 * 4 ** Math.min(attempts - 1, 3);
}

export type DeliveryRequest = {
  organizationId: string;
  eventId: string;
  channelIds: string[];
  notification: AlertNotification;
};

/**
 * The outbox rows for one alert event, ready to insert.
 *
 * Split from `enqueueDeliveries` so the alert runner can queue every event of
 * an evaluation in one INSERT, inside the same transaction as the events.
 */
export function deliveryRows(
  input: DeliveryRequest,
): Array<typeof alertDeliveries.$inferInsert> {
  // Rendered once, at queue time, so a channel edited between queueing and
  // sending cannot rewrite what the alert said.
  const payloadJson = JSON.stringify(input.notification);

  return input.channelIds.map((channelId) => ({
    id: createId("dlv"),
    organizationId: input.organizationId,
    eventId: input.eventId,
    channelId,
    payloadJson,
  }));
}

export async function enqueueDeliveries(
  input: DeliveryRequest,
): Promise<number> {
  if (input.channelIds.length === 0) return 0;

  const db = await getDb();
  await db.insert(alertDeliveries).values(deliveryRows(input));

  return input.channelIds.length;
}

/**
 * Claim due deliveries by pushing their next attempt forward.
 *
 * The same claim-by-timestamp pattern the sync worker uses: `FOR UPDATE SKIP
 * LOCKED` gives concurrent drainers disjoint rows, and a drainer that dies
 * mid-send simply leaves its rows to become due again.
 */
async function claimDue(limit: number) {
  const db = await getDb();
  const now = new Date();

  const due = db
    .select({ id: alertDeliveries.id })
    .from(alertDeliveries)
    .where(
      and(
        eq(alertDeliveries.status, "pending"),
        lte(alertDeliveries.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(alertDeliveries.nextAttemptAt))
    .limit(limit)
    .for("update", { skipLocked: true });

  return db
    .update(alertDeliveries)
    .set({
      nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_SECONDS * 1000),
      attempts: sql`${alertDeliveries.attempts} + 1`,
    })
    .where(inArray(alertDeliveries.id, due))
    .returning({
      id: alertDeliveries.id,
      eventId: alertDeliveries.eventId,
      channelId: alertDeliveries.channelId,
      payloadJson: alertDeliveries.payloadJson,
      attempts: alertDeliveries.attempts,
    });
}

/**
 * Send whatever is due.
 *
 * Never throws: this runs from the scheduler tick, and a delivery problem must
 * not take the tick — and therefore syncing — down with it.
 */
export async function drainDeliveries(
  limit = DRAIN_BATCH,
): Promise<DrainReport> {
  try {
    return await run(limit);
  } catch (error) {
    log.warn("drain failed", {}, error);
    return EMPTY;
  }
}

type Outcome = {
  row: Awaited<ReturnType<typeof claimDue>>[number];
  delivery: Delivery;
  terminal: boolean;
};

async function run(limit: number): Promise<DrainReport> {
  const claimed = await claimDue(limit);
  if (claimed.length === 0) return EMPTY;

  const db = await getDb();
  const report = { ...EMPTY, attempted: claimed.length };

  // One read for every channel in the batch rather than one per delivery:
  // alerts fan out, so a batch is mostly the same few channels.
  const channelRows = await db
    .select()
    .from(notificationChannels)
    .where(
      inArray(notificationChannels.id, [
        ...new Set(claimed.map((row) => row.channelId)),
      ]),
    );
  const channels = new Map(channelRows.map((channel) => [channel.id, channel]));

  const outcomes: Outcome[] = await Promise.all(
    claimed.map(async (row) => {
      const channel = channels.get(row.channelId);

      if (!channel || !channel.enabled) {
        return {
          row,
          delivery: {
            channelId: row.channelId,
            kind: channel?.kind ?? "email",
            ok: false,
            error: channel ? "Channel is disabled." : "Channel was removed.",
          } as Delivery,
          // No point retrying something that is gone or switched off.
          terminal: true,
        };
      }

      let target: string;
      try {
        target = decryptSecret(channel.targetEncrypted);
      } catch (error) {
        // Almost always a rotated BUSSOLA_ENCRYPTION_KEY. Retrying will not
        // help, and the message names the fix — but the underlying error is
        // what tells an operator whether it was the key or a damaged row.
        log.warn(
          "could not decrypt channel target",
          { channelId: channel.id, organizationId: channel.organizationId },
          error,
        );
        return {
          row,
          delivery: {
            channelId: row.channelId,
            kind: channel.kind,
            ok: false,
            error: "Could not decrypt this channel — re-enter its destination.",
          } as Delivery,
          terminal: true,
        };
      }

      const notification = JSON.parse(row.payloadJson) as AlertNotification;
      const delivery = await deliver(
        {
          id: channel.id,
          kind: channel.kind,
          label: channel.label,
          target,
        },
        notification,
      );

      return { row, delivery, terminal: false };
    }),
  );

  const now = new Date();
  const updates = settle(outcomes, now, report);

  /*
   * Everything the drain learned, written together.
   *
   * This used to be two UPDATEs per delivery and a read plus a write per
   * event, one round trip at a time and outside any transaction — so a
   * failure part-way could mark a delivery sent while the event feed still
   * said "queued". It is now four statements whatever the batch size, and
   * they land together or not at all. Nothing in here calls out to a
   * provider: the sending is done, this is only bookkeeping.
   */
  await db.transaction(async (tx) => {
    const outcome = valuesTable(
      "outcome",
      {
        id: "text",
        status: "text",
        last_error: "text",
        next_attempt_at: "timestamptz",
        delivered: "boolean",
      },
      updates.deliveries,
    );
    await tx
      .update(alertDeliveries)
      .set({
        status: sql<AlertDeliveryStatus>`${outcome.column("status")}`,
        lastError: outcome.column("last_error"),
        // Only a retry moves the schedule; sent and abandoned rows keep theirs.
        nextAttemptAt: sql`coalesce(${outcome.column("next_attempt_at")}, ${alertDeliveries.nextAttemptAt})`,
        deliveredAt: sql`case when ${outcome.column("delivered")} then ${now.toISOString()}::timestamptz else ${alertDeliveries.deliveredAt} end`,
      })
      .from(outcome.from)
      .where(eq(alertDeliveries.id, outcome.column("id")));

    const channel = valuesTable(
      "channel",
      { id: "text", last_error: "text", delivered: "boolean" },
      updates.channels,
    );
    await tx
      .update(notificationChannels)
      .set({
        lastError: channel.column("last_error"),
        lastDeliveredAt: sql`case when ${channel.column("delivered")} then ${now.toISOString()}::timestamptz else ${notificationChannels.lastDeliveredAt} end`,
      })
      .from(channel.from)
      .where(eq(notificationChannels.id, channel.column("id")));

    // The event carries the summary the alert feed renders, so it is refreshed
    // for every drained event rather than left showing "queued" forever.
    await refreshEventSummaries(tx, [
      ...new Set(outcomes.map(({ row }) => row.eventId)),
    ]);
  });

  return report;
}

/**
 * Turn outcomes into the rows to write, and count them into the report.
 *
 * A channel can appear more than once in a batch. The per-delivery loop this
 * replaces wrote each outcome in turn, so the last one decided the channel's
 * `lastError` and any success stamped `lastDeliveredAt`; folding them here
 * keeps exactly that result.
 */
function settle(outcomes: Outcome[], now: Date, report: DrainReport) {
  const deliveries: Array<{
    id: string;
    status: AlertDeliveryStatus;
    last_error: string | null;
    next_attempt_at: Date | null;
    delivered: boolean;
  }> = [];
  const channels = new Map<
    string,
    { id: string; last_error: string | null; delivered: boolean }
  >();

  for (const { row, delivery, terminal } of outcomes) {
    const exhausted = terminal || row.attempts >= MAX_ATTEMPTS;
    const error = delivery.error ?? "Delivery failed";

    if (delivery.ok) report.sent += 1;
    else if (exhausted) report.abandoned += 1;
    else report.failed += 1;

    deliveries.push(
      delivery.ok
        ? { id: row.id, status: "sent", last_error: null, next_attempt_at: null, delivered: true }
        : exhausted
          ? { id: row.id, status: "failed", last_error: error, next_attempt_at: null, delivered: false }
          : {
              id: row.id,
              status: "pending",
              last_error: error,
              next_attempt_at: new Date(
                now.getTime() + backoffSeconds(row.attempts) * 1000,
              ),
              delivered: false,
            },
    );

    channels.set(delivery.channelId, {
      id: delivery.channelId,
      last_error: delivery.ok ? null : error,
      delivered:
        delivery.ok || (channels.get(delivery.channelId)?.delivered ?? false),
    });
  }

  return { deliveries, channels: [...channels.values()] };
}

/** Fold each event's delivery rows back into the summary the UI reads. */
async function refreshEventSummaries(
  tx: BussolaTx,
  eventIds: string[],
): Promise<void> {
  if (eventIds.length === 0) return;

  const rows = await tx
    .select({
      eventId: alertDeliveries.eventId,
      channelId: alertDeliveries.channelId,
      status: alertDeliveries.status,
      lastError: alertDeliveries.lastError,
      kind: notificationChannels.kind,
    })
    .from(alertDeliveries)
    .leftJoin(
      notificationChannels,
      eq(alertDeliveries.channelId, notificationChannels.id),
    )
    .where(inArray(alertDeliveries.eventId, eventIds));

  const summaries = new Map<string, unknown[]>(eventIds.map((id) => [id, []]));
  for (const row of rows) {
    summaries.get(row.eventId)?.push({
      channelId: row.channelId,
      kind: row.kind ?? "email",
      ok: row.status === "sent",
      ...(row.status === "sent" ? {} : { error: row.lastError ?? "Queued" }),
    });
  }

  const summary = valuesTable(
    "summary",
    { id: "text", deliveries_json: "text" },
    [...summaries].map(([id, deliveries]) => ({
      id,
      deliveries_json: JSON.stringify(deliveries),
    })),
  );
  await tx
    .update(alertEvents)
    .set({ deliveriesJson: summary.column("deliveries_json") })
    .from(summary.from)
    .where(eq(alertEvents.id, summary.column("id")));
}
