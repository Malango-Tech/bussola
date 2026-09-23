import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read, request } from "@/test/http";
import {
  actAs,
  reposFor,
  seedConnection,
  seedTenants,
  type Tenants,
} from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

type Rule = {
  id: string;
  metric: string;
  channelIds: string[];
  enabled: boolean;
  mutedUntil: string | null;
};

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let ourVercel: string;
let ourChannel: string;
let theirVercel: string;
let theirChannel: string;
let theirRule: string;

const create = (body: unknown) =>
  read<{ rule: Rule }>(route.POST(request("/api/alerts/rules", { method: "POST", body })));
const patch = (body: unknown) =>
  read<{ rule: Rule }>(route.PATCH(request("/api/alerts/rules", { method: "PATCH", body })));
const remove = (id?: string) =>
  read(route.DELETE(request(`/api/alerts/rules${id ? `?id=${id}` : ""}`, { method: "DELETE" })));

const validRule = () => ({
  connectionId: ourVercel,
  metric: "vercel.failedProjects",
  comparator: "above",
  threshold: 0,
});

beforeAll(async () => {
  testDb = await startTestDb("alert-rules-route");
  t = await seedTenants(testDb);
  const { encryptSecret } = await import("@/lib/crypto/vault");

  ourVercel = (await seedConnection(t.acme.owner, "vercel")).id;
  ourChannel = (
    await (await reposFor(t.acme.owner)).channels.create({
      kind: "email",
      label: "On-call",
      targetEncrypted: encryptSecret("oncall@acme.test"),
    })
  ).id;

  const other = await reposFor(t.other.owner);
  theirVercel = (await seedConnection(t.other.owner, "vercel")).id;
  theirChannel = (
    await other.channels.create({
      kind: "email",
      label: "Theirs",
      targetEncrypted: encryptSecret("them@other.test"),
    })
  ).id;
  theirRule = (
    await other.alertRules.create({
      connectionId: theirVercel,
      metric: "vercel.failedProjects",
      comparator: "above",
      threshold: "0",
      channelIds: [],
      cooldownMinutes: 60,
    })
  ).id;

  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

// Rules are how members use alerts; nothing here needs more than a member.
beforeEach(() => actAs(t.acme.member));

describe("GET /api/alerts/rules", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await route.GET()).status).toBe(401);
  });

  it("lists this organization's rules with the metric catalog", async () => {
    await create(validRule());
    const { status, body } = await read<{ rules: Rule[]; metrics: unknown[] }>(route.GET());
    expect(status).toBe(200);
    expect(body.metrics.length).toBeGreaterThan(0);
    expect(body.rules.length).toBeGreaterThan(0);
    expect(body.rules.map((rule) => rule.id)).not.toContain(theirRule);
  });
});

describe("POST /api/alerts/rules", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await create(validRule())).status).toBe(401);
  });

  it("creates a rule, keeping only this organization's channels", async () => {
    const { status, body } = await create({
      ...validRule(),
      channelIds: [ourChannel, theirChannel],
      cooldownMinutes: 30,
    });
    expect(status).toBe(201);
    expect(body.rule).toMatchObject({
      metric: "vercel.failedProjects",
      channelIds: [ourChannel],
      enabled: true,
    });
  });

  it("rejects an invalid payload", async () => {
    expect((await create({ ...validRule(), comparator: "sideways" })).status).toBe(400);
    expect((await create({ ...validRule(), threshold: "ten" })).status).toBe(400);
    expect((await create({ ...validRule(), cooldownMinutes: 1 })).status).toBe(400);
  });

  it("rejects an unknown metric, or one from another provider", async () => {
    const unknown = await create({ ...validRule(), metric: "vercel.nope" });
    expect(unknown.status).toBe(400);
    const mismatch = await create({ ...validRule(), metric: "railway.failedDeploys" });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toMatch(/railway metric, not vercel/);
  });

  it("cannot watch another organization's connection", async () => {
    expect((await create({ ...validRule(), connectionId: theirVercel })).status).toBe(404);
  });
});

describe("PATCH /api/alerts/rules", () => {
  it("mutes, unmutes and disables", async () => {
    const { body: created } = await create(validRule());
    const muted = await patch({ id: created.rule.id, muteHours: 24 });
    expect(muted.status).toBe(200);
    expect(new Date(muted.body.rule.mutedUntil!).getTime()).toBeGreaterThan(Date.now());

    const unmuted = await patch({ id: created.rule.id, muteHours: 0, enabled: false });
    expect(unmuted.body.rule).toMatchObject({ mutedUntil: null, enabled: false });
  });

  it("rejects an invalid payload", async () => {
    expect((await patch({ muteHours: 1 })).status).toBe(400);
    expect((await patch({ id: "x", muteHours: 10_000 })).status).toBe(400);
  });

  it("cannot change another organization's rule, or point ours at their channel", async () => {
    expect((await patch({ id: theirRule, enabled: false })).status).toBe(404);

    const { body: created } = await create(validRule());
    const { body } = await patch({ id: created.rule.id, channelIds: [theirChannel] });
    expect(body.rule.channelIds).toEqual([]);
  });
});

describe("DELETE /api/alerts/rules", () => {
  it("requires an id", async () => {
    expect((await remove()).status).toBe(400);
  });

  it("removes its own rule", async () => {
    const { body: created } = await create(validRule());
    expect((await remove(created.rule.id)).status).toBe(200);
    expect((await remove(created.rule.id)).status).toBe(404);
  });

  it("cannot remove another organization's rule", async () => {
    expect((await remove(theirRule)).status).toBe(404);
    expect(await (await reposFor(t.other.owner)).alertRules.get(theirRule)).toBeTruthy();
  });
});
