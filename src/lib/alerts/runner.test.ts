import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createId } from "@/lib/id";

/**
 * The alert engine, end to end against a real Postgres (PGlite).
 *
 * `evaluate.test.ts` covers the decision in isolation; this covers everything
 * around it — that a breach writes an event, that a continuing breach does not
 * write a second one, that a recovery does, and that a channel refusing
 * delivery still leaves the alert recorded. Those are the properties that only
 * show up once state is actually persisted between evaluations.
 */

/** Delivery is stubbed: these tests are about the engine, not about Slack. */
const delivery = vi.hoisted(() => ({ deliver: vi.fn() }));

vi.mock("./deliver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deliver")>()),
  deliver: delivery.deliver,
}));

let dataDir: string;
let organizationId: string;
let connectionId: string;
let channelId: string;
let closeDb: () => Promise<void>;

type Db = Awaited<ReturnType<typeof import("@/lib/db").getDb>>;
let handle: Db;
let schema: typeof import("@/lib/db/schema");
let evaluateAlertsForConnection: typeof import("./runner").evaluateAlertsForConnection;
let drainDeliveries: typeof import("./outbox").drainDeliveries;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bussola-alerts-"));
  process.env.BUSSOLA_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  delete process.env.BUSSOLA_EDITION;

  const db = await import("@/lib/db");
  schema = await import("@/lib/db/schema");
  ({ eq } = await import("drizzle-orm"));
  ({ evaluateAlertsForConnection } = await import("./runner"));
  ({ drainDeliveries } = await import("./outbox"));

  await db.runMigrations();
  closeDb = db.closeDb;
  handle = await db.getDb();

  organizationId = createId("org");
  const userId = createId("usr");
  await handle.insert(schema.organization).values({
    id: organizationId,
    name: "Alerts",
    slug: `alerts-${organizationId.slice(-6)}`,
  });
  await handle.insert(schema.user).values({
    id: userId,
    name: "Owner",
    email: `${organizationId}@example.test`,
  });
  await handle.insert(schema.member).values({
    id: createId("mem"),
    organizationId,
    userId,
    role: "owner",
  });

  connectionId = createId("con");
  await handle.insert(schema.connections).values({
    id: connectionId,
    organizationId,
    provider: "railway",
    label: "Railway",
    credentialsEncrypted: "unused-in-this-suite",
  });

  const { encryptSecret } = await import("@/lib/crypto/vault");
  channelId = createId("nch");
  await handle.insert(schema.notificationChannels).values({
    id: channelId,
    organizationId,
    kind: "slack",
    label: "Ops",
    targetEncrypted: encryptSecret("https://hooks.slack.com/services/T/B/x"),
  });
}, 60_000);

afterAll(async () => {
  await closeDb?.();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Replace the stored snapshot, as a successful sync would. */
async function setSnapshot(payload: unknown) {
  await handle
    .insert(schema.connectionSnapshots)
    .values({
      id: createId("snp"),
      organizationId,
      connectionId,
      kind: "dashboard",
      payloadJson: JSON.stringify(payload),
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.connectionSnapshots.connectionId, schema.connectionSnapshots.kind],
      set: { payloadJson: JSON.stringify(payload), fetchedAt: new Date() },
    });
}

async function addRule(over: Partial<{ metric: string; comparator: "above" | "below"; threshold: string; channelIds: string[] }> = {}) {
  const id = createId("alr");
  await handle.insert(schema.alertRules).values({
    id,
    organizationId,
    connectionId,
    metric: over.metric ?? "railway.crashedServices",
    comparator: over.comparator ?? "above",
    threshold: over.threshold ?? "0",
    channelIdsJson: JSON.stringify(over.channelIds ?? [channelId]),
    cooldownMinutes: 60,
  });
  return id;
}

async function events() {
  return handle
    .select()
    .from(schema.alertEvents)
    .where(eq(schema.alertEvents.organizationId, organizationId));
}

async function ruleRow(id: string) {
  const [row] = await handle
    .select()
    .from(schema.alertRules)
    .where(eq(schema.alertRules.id, id))
    .limit(1);
  return row;
}

async function deliveries() {
  return handle
    .select()
    .from(schema.alertDeliveries)
    .where(eq(schema.alertDeliveries.organizationId, organizationId));
}

async function reset() {
  // alert_deliveries cascades from alert_events, but the order is explicit so
  // a failure here reads as a test-setup problem rather than a constraint one.
  await handle.delete(schema.alertDeliveries);
  await handle.delete(schema.alertEvents);
  await handle.delete(schema.alertRules);
  await handle
    .update(schema.notificationChannels)
    .set({ lastError: null, lastDeliveredAt: null, enabled: true });
  delivery.deliver.mockReset();
  delivery.deliver.mockResolvedValue({ channelId, kind: "slack", ok: true });
}

const CRASHED = { fleet: { healthy: 2, total: 3, crashed: 1 } };
const HEALTHY = { fleet: { healthy: 3, total: 3, crashed: 0 } };

describe("evaluateAlertsForConnection", () => {
  beforeEach(reset);

  it("does nothing when there are no rules", async () => {
    await setSnapshot(CRASHED);
    const report = await evaluateAlertsForConnection({
      connectionId,
      organizationId,
    });
    expect(report.evaluated).toBe(0);
    expect(await events()).toHaveLength(0);
  });

  it("records a breach and queues the notification", async () => {
    const ruleId = await addRule();
    await setSnapshot(CRASHED);

    const report = await evaluateAlertsForConnection({ connectionId, organizationId });

    expect(report).toMatchObject({
      evaluated: 1,
      breached: 1,
      notified: 1,
      queued: 1,
    });

    const [event] = await events();
    expect(event.state).toBe("breached");
    expect(event.value).toBe("1");
    expect(event.message).toContain("Crashed services");

    const rule = await ruleRow(ruleId);
    expect(rule.lastState).toBe("breached");
    expect(rule.lastNotifiedAt).not.toBeNull();
  });

  it("sends nothing during evaluation", async () => {
    // The property the outbox exists for: a webhook's latency must never be on
    // the critical path of the sync that triggered the alert.
    await addRule();
    await setSnapshot(CRASHED);

    await evaluateAlertsForConnection({ connectionId, organizationId });

    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(await deliveries()).toMatchObject([{ status: "pending", attempts: 0 }]);
  });

  it("stays quiet while the same breach continues", async () => {
    await addRule();
    await setSnapshot(CRASHED);
    await evaluateAlertsForConnection({ connectionId, organizationId });
    delivery.deliver.mockClear();

    // The property that makes this an alert rather than a cron job: a second
    // evaluation of an unchanged breach must not send a second message.
    const report = await evaluateAlertsForConnection({ connectionId, organizationId });

    expect(report.notified).toBe(0);
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(await events()).toHaveLength(1);
  });

  it("notifies the moment the breach clears", async () => {
    await addRule();
    await setSnapshot(CRASHED);
    await evaluateAlertsForConnection({ connectionId, organizationId });

    await setSnapshot(HEALTHY);
    const report = await evaluateAlertsForConnection({ connectionId, organizationId });

    expect(report.recovered).toBe(1);
    expect(report.notified).toBe(1);

    const all = await events();
    expect(all).toHaveLength(2);
    expect(all.some((event) => event.state === "ok")).toBe(true);
  });

  it("keeps the alert even when every channel refuses it", async () => {
    // A dead webhook must lose the notification, never the record — otherwise
    // "nothing fired" and "nothing could be delivered" look identical.
    delivery.deliver.mockResolvedValue({
      channelId,
      kind: "slack",
      ok: false,
      error: "Webhook returned 404",
    });
    await addRule();
    await setSnapshot(CRASHED);

    await evaluateAlertsForConnection({ connectionId, organizationId });
    await drainDeliveries();

    const [event] = await events();
    expect(event.state).toBe("breached");
    expect(JSON.parse(event.deliveriesJson)[0]).toMatchObject({ ok: false });
  });

  it("records a failed delivery on the channel itself", async () => {
    delivery.deliver.mockResolvedValue({
      channelId,
      kind: "slack",
      ok: false,
      error: "Webhook returned 404",
    });
    await addRule();
    await setSnapshot(CRASHED);
    await evaluateAlertsForConnection({ connectionId, organizationId });
    await drainDeliveries();

    const [channel] = await handle
      .select()
      .from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.id, channelId))
      .limit(1);
    expect(channel.lastError).toContain("404");
  });

  it("fires a rule with no channels, into the in-app feed only", async () => {
    await addRule({ channelIds: [] });
    await setSnapshot(CRASHED);

    const report = await evaluateAlertsForConnection({ connectionId, organizationId });

    expect(report.notified).toBe(1);
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(await events()).toHaveLength(1);
  });

  it("skips a metric the snapshot does not carry, without firing", async () => {
    const ruleId = await addRule({
      metric: "railway.estimatedBill",
      comparator: "above",
      threshold: "10",
    });
    // A project-scoped Railway token reports no billing section at all.
    await setSnapshot(CRASHED);

    const report = await evaluateAlertsForConnection({ connectionId, organizationId });

    expect(report.evaluated).toBe(0);
    expect(await events()).toHaveLength(0);
    // Still stamped, so the UI can say "checked, nothing to read".
    expect((await ruleRow(ruleId)).lastEvaluatedAt).not.toBeNull();
  });

  it("never lets a delivery failure escape into the sync path", async () => {
    delivery.deliver.mockRejectedValue(new Error("network exploded"));
    await addRule();
    await setSnapshot(CRASHED);

    await expect(
      evaluateAlertsForConnection({ connectionId, organizationId }),
    ).resolves.toBeDefined();
    await expect(drainDeliveries()).resolves.toBeDefined();
  });

  it("ignores rules belonging to another organization's connection", async () => {
    const otherOrg = createId("org");
    await handle.insert(schema.organization).values({
      id: otherOrg,
      name: "Other",
      slug: `other-${otherOrg.slice(-6)}`,
    });
    await addRule();
    await setSnapshot(CRASHED);

    // Right connection, wrong tenant: the rule must not be found.
    const report = await evaluateAlertsForConnection({
      connectionId,
      organizationId: otherOrg,
    });

    expect(report.evaluated).toBe(0);
    expect(await events()).toHaveLength(0);
  });
});

describe("drainDeliveries", () => {
  beforeEach(reset);

  async function queueOne() {
    await addRule();
    await setSnapshot(CRASHED);
    await evaluateAlertsForConnection({ connectionId, organizationId });
  }

  it("does nothing when the queue is empty", async () => {
    const report = await drainDeliveries();
    expect(report.attempted).toBe(0);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("sends a queued notification and marks it sent", async () => {
    await queueOne();
    const report = await drainDeliveries();

    expect(report).toMatchObject({ attempted: 1, sent: 1 });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    const [row] = await deliveries();
    expect(row.status).toBe("sent");
    expect(row.deliveredAt).not.toBeNull();
  });

  it("hands the channel its decrypted destination, and only then", async () => {
    await queueOne();
    await drainDeliveries();

    const [target] = delivery.deliver.mock.calls[0]!;
    expect(target).toMatchObject({
      id: channelId,
      kind: "slack",
      target: "https://hooks.slack.com/services/T/B/x",
    });
  });

  it("leaves a sent notification alone on the next drain", async () => {
    await queueOne();
    await drainDeliveries();
    delivery.deliver.mockClear();

    const second = await drainDeliveries();
    expect(second.attempted).toBe(0);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("keeps a failure pending for a retry rather than dropping it", async () => {
    delivery.deliver.mockResolvedValue({
      channelId,
      kind: "slack",
      ok: false,
      error: "Webhook returned 503",
    });
    await queueOne();

    const report = await drainDeliveries();
    expect(report).toMatchObject({ sent: 0, failed: 1, abandoned: 0 });

    const [row] = await deliveries();
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("503");
  });

  it("backs off, so a dead webhook is not retried every tick", async () => {
    delivery.deliver.mockResolvedValue({
      channelId,
      kind: "slack",
      ok: false,
      error: "gone",
    });
    await queueOne();
    await drainDeliveries();

    const [row] = await deliveries();
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    // Not yet due, so a second drain finds nothing.
    delivery.deliver.mockClear();
    expect((await drainDeliveries()).attempted).toBe(0);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("gives up after five attempts and says so", async () => {
    delivery.deliver.mockResolvedValue({
      channelId,
      kind: "slack",
      ok: false,
      error: "gone",
    });
    await queueOne();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      // Force the row due again rather than waiting out the backoff.
      await handle
        .update(schema.alertDeliveries)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) });
      await drainDeliveries();
    }

    const [row] = await deliveries();
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(5);
  });

  it("does not retry a channel that has been switched off", async () => {
    await queueOne();
    await handle
      .update(schema.notificationChannels)
      .set({ enabled: false })
      .where(eq(schema.notificationChannels.id, channelId));

    const report = await drainDeliveries();
    expect(report.abandoned).toBe(1);
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect((await deliveries())[0].status).toBe("failed");
  });

  it("folds outcomes back into the event the feed renders", async () => {
    await queueOne();
    await drainDeliveries();

    const [event] = await events();
    expect(JSON.parse(event.deliveriesJson)).toMatchObject([
      { channelId, kind: "slack", ok: true },
    ]);
  });
});

describe("batched writes", () => {
  beforeEach(reset);

  async function addChannel(kind: "slack" | "discord", url: string) {
    const { encryptSecret } = await import("@/lib/crypto/vault");
    const id = createId("nch");
    await handle.insert(schema.notificationChannels).values({
      id,
      organizationId,
      kind,
      label: kind,
      targetEncrypted: encryptSecret(url),
    });
    return id;
  }

  async function channelRow(id: string) {
    const [row] = await handle
      .select()
      .from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.id, id))
      .limit(1);
    return row;
  }

  it("writes a whole evaluation — fired, quiet and skipped rules — together", async () => {
    const fires = await addRule({ threshold: "0" });
    const quiet = await addRule({ threshold: "5" });
    const skipped = await addRule({ metric: "railway.estimatedBill" });
    await setSnapshot(CRASHED);

    const report = await evaluateAlertsForConnection({ connectionId, organizationId });
    expect(report).toMatchObject({ evaluated: 2, breached: 1, notified: 1, queued: 1 });

    const fired = await ruleRow(fires);
    expect(fired.lastState).toBe("breached");
    expect(fired.lastValue).toBe("1");
    expect(fired.lastNotifiedAt).not.toBeNull();
    expect(fired.lastEvaluatedAt).not.toBeNull();

    const calm = await ruleRow(quiet);
    expect(calm.lastState).toBe("ok");
    expect(calm.lastValue).toBe("1");
    // Evaluated but not notified: the cooldown clock must not move.
    expect(calm.lastNotifiedAt).toBeNull();

    const untouched = await ruleRow(skipped);
    expect(untouched.lastEvaluatedAt).not.toBeNull();
    expect(untouched.lastState).toBeNull();

    const [event] = await events();
    expect(event.ruleId).toBe(fires);
    expect(await deliveries()).toMatchObject([
      { eventId: event.id, channelId, status: "pending" },
    ]);
  });

  it("keeps a rule's earlier notification time when it evaluates without notifying", async () => {
    const ruleId = await addRule();
    await setSnapshot(CRASHED);
    await evaluateAlertsForConnection({ connectionId, organizationId });
    const first = (await ruleRow(ruleId)).lastNotifiedAt;
    expect(first).not.toBeNull();

    // Same breach again: evaluated, not notified.
    await evaluateAlertsForConnection({ connectionId, organizationId });
    expect((await ruleRow(ruleId)).lastNotifiedAt).toEqual(first);
  });

  it("drains a mixed batch in one pass, settling every row it touched", async () => {
    const failing = await addChannel("discord", "https://discord.com/api/webhooks/1/x");
    delivery.deliver.mockImplementation(
      async (channel: { id: string; kind: string }) =>
        channel.id === channelId
          ? { channelId: channel.id, kind: channel.kind, ok: true }
          : {
              channelId: channel.id,
              kind: channel.kind,
              ok: false,
              error: "Webhook returned 500",
            },
    );

    const both = await addRule({ channelIds: [channelId, failing] });
    const onlyFailing = await addRule({ channelIds: [failing] });
    await setSnapshot(CRASHED);
    await evaluateAlertsForConnection({ connectionId, organizationId });

    const report = await drainDeliveries();
    expect(report).toEqual({ attempted: 3, sent: 1, failed: 2, abandoned: 0 });

    const rows = await deliveries();
    expect(rows.filter((row) => row.status === "sent")).toMatchObject([
      { channelId },
    ]);
    const retrying = rows.filter((row) => row.status === "pending");
    expect(retrying).toHaveLength(2);
    for (const row of retrying) {
      expect(row.channelId).toBe(failing);
      expect(row.lastError).toContain("500");
      expect(row.deliveredAt).toBeNull();
      expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    }

    const good = await channelRow(channelId);
    expect(good.lastDeliveredAt).not.toBeNull();
    expect(good.lastError).toBeNull();
    const bad = await channelRow(failing);
    expect(bad.lastDeliveredAt).toBeNull();
    expect(bad.lastError).toContain("500");

    // Each event's summary covers exactly its own deliveries.
    const summaries = Object.fromEntries(
      (await events()).map((event) => [
        event.ruleId,
        JSON.parse(event.deliveriesJson),
      ]),
    );
    expect(summaries[both]).toHaveLength(2);
    expect(summaries[both]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channelId, ok: true }),
        expect.objectContaining({
          channelId: failing,
          ok: false,
          error: "Webhook returned 500",
        }),
      ]),
    );
    expect(summaries[onlyFailing]).toEqual([
      expect.objectContaining({ channelId: failing, kind: "discord", ok: false }),
    ]);

    await handle
      .delete(schema.notificationChannels)
      .where(eq(schema.notificationChannels.id, failing));
  });
});
