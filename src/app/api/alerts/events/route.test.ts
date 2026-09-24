import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read, request } from "@/test/http";
import {
  actAs,
  reposFor,
  seedConnection,
  seedTenants,
  type Actor,
  type Tenants,
} from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

type Event = { id: string; state: string; acknowledgedAt: string | null };

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let ourRule: string;
let theirEvent: string;

const list = (query = "") =>
  read<{ events: Event[]; unacknowledged: number }>(
    route.GET(request(`/api/alerts/events${query}`)),
  );
const acknowledge = (body: unknown) =>
  read<{ ok: boolean; acknowledged: number }>(
    route.POST(request("/api/alerts/events", { method: "POST", body })),
  );

/** A rule on a fresh connection, for events to hang off. */
async function seedRule(actor: Actor) {
  const connection = await seedConnection(actor, "vercel");
  const rule = await (await reposFor(actor)).alertRules.create({
    connectionId: connection.id,
    metric: "vercel.failedProjects",
    comparator: "above",
    threshold: "0",
    channelIds: [],
    cooldownMinutes: 60,
  });
  return rule.id;
}

beforeAll(async () => {
  testDb = await startTestDb("alert-events-route");
  t = await seedTenants(testDb);
  ourRule = await seedRule(t.acme.owner);
  theirEvent = await testDb.alertEvent(t.other.id, await seedRule(t.other.owner));
  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => actAs(t.acme.member));

describe("GET /api/alerts/events", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await route.GET(request("/api/alerts/events"))).status).toBe(401);
  });

  it("lists this organization's events, newest first, with the unread count", async () => {
    const first = await testDb.alertEvent(t.acme.id, ourRule, "breached");
    const second = await testDb.alertEvent(t.acme.id, ourRule, "ok");
    const { status, body } = await list();
    expect(status).toBe(200);
    const ids = body.events.map((event) => event.id);
    expect(ids).toEqual(expect.arrayContaining([first, second]));
    expect(ids).not.toContain(theirEvent);
    expect(body.unacknowledged).toBeGreaterThanOrEqual(1);
  });

  it("clamps the limit instead of failing on a silly one", async () => {
    await testDb.alertEvent(t.acme.id, ourRule);
    expect((await list("?limit=0")).body.events).toHaveLength(1);
    expect((await list("?limit=banana")).status).toBe(200);
  });
});

describe("POST /api/alerts/events", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await acknowledge({})).status).toBe(401);
  });

  it("acknowledges one event", async () => {
    const id = await testDb.alertEvent(t.acme.id, ourRule);
    const { status, body } = await acknowledge({ id });
    expect(status).toBe(200);
    expect(body.acknowledged).toBe(1);
  });

  it("acknowledges everything outstanding, and only this organization's", async () => {
    await testDb.alertEvent(t.acme.id, ourRule);
    const { body } = await acknowledge({});
    expect(body.acknowledged).toBeGreaterThanOrEqual(1);
    expect((await list()).body.unacknowledged).toBe(0);

    actAs(t.other.owner);
    expect((await list()).body.unacknowledged).toBe(1);
  });

  it("rejects an invalid payload", async () => {
    expect((await acknowledge({ id: 7 })).status).toBe(400);
  });

  it("cannot acknowledge another organization's event", async () => {
    expect((await acknowledge({ id: theirEvent })).status).toBe(404);
  });
});
