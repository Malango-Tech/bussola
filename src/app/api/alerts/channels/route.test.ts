import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read, request } from "@/test/http";
import { actAs, reposFor, seedTenants, type Tenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

type Channel = { id: string; kind: string; label: string; enabled: boolean };

const SLACK = "https://hooks.slack.com/services/T000/B000/secret";

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let theirChannel: string;

const create = (body: unknown) =>
  read<{ channel: Channel }>(route.POST(request("/api/alerts/channels", { method: "POST", body })));
const patch = (body: unknown) =>
  read<{ channel: Channel }>(route.PATCH(request("/api/alerts/channels", { method: "PATCH", body })));
const remove = (id?: string) =>
  read(route.DELETE(request(`/api/alerts/channels${id ? `?id=${id}` : ""}`, { method: "DELETE" })));

beforeAll(async () => {
  testDb = await startTestDb("alert-channels-route");
  t = await seedTenants(testDb);
  const { encryptSecret } = await import("@/lib/crypto/vault");
  theirChannel = (
    await (await reposFor(t.other.owner)).channels.create({
      kind: "slack",
      label: "Their Slack",
      targetEncrypted: encryptSecret(SLACK),
    })
  ).id;
  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => actAs(t.acme.admin));

describe("GET /api/alerts/channels", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await route.GET()).status).toBe(401);
  });

  it("shows a member where alerts go, but never the destination itself", async () => {
    await create({ kind: "slack", label: "Ops", target: SLACK });
    actAs(t.acme.member);
    const { status, body } = await read<{ channels: Channel[]; allowedKinds: string[] }>(
      route.GET(),
    );
    expect(status).toBe(200);
    expect(body.allowedKinds).toEqual(["email", "slack", "discord"]);
    expect(body.channels.map((channel) => channel.label)).toContain("Ops");
    expect(body.channels.map((channel) => channel.id)).not.toContain(theirChannel);
    expect(JSON.stringify(body)).not.toContain("hooks.slack.com");
  });
});

describe("POST /api/alerts/channels", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await create({ kind: "slack", label: "x", target: SLACK })).status).toBe(401);
  });

  it("is refused to a member", async () => {
    actAs(t.acme.member);
    const { status, body } = await create({ kind: "slack", label: "x", target: SLACK });
    expect(status).toBe(403);
    expect(body.error).toMatch(/owner or admin/);
  });

  it("adds a channel for an admin", async () => {
    const { status, body } = await create({ kind: "email", label: " Pager ", target: "pager@acme.test" });
    expect(status).toBe(201);
    expect(body.channel).toMatchObject({ kind: "email", label: "Pager", enabled: true });
    expect(body.channel).not.toHaveProperty("targetEncrypted");
  });

  it("rejects an invalid payload", async () => {
    expect((await create({ kind: "pigeon", label: "x", target: SLACK })).status).toBe(400);
    expect((await create({ kind: "slack", label: "", target: SLACK })).status).toBe(400);
  });

  it("rejects a destination that could never deliver", async () => {
    const wrongHost = await create({ kind: "slack", label: "x", target: "https://example.com/hook" });
    expect(wrongHost.status).toBe(400);
    expect(wrongHost.body.error).toMatch(/hooks\.slack\.com/);
    const plainHttp = await create({ kind: "discord", label: "x", target: "http://discord.com/api/webhooks/1" });
    expect(plainHttp.body.error).toMatch(/https/);
    const email = await create({ kind: "email", label: "x", target: "not-an-address" });
    expect(email.status).toBe(400);
  });
});

describe("PATCH /api/alerts/channels", () => {
  it("is refused to a member", async () => {
    const { body } = await create({ kind: "slack", label: "x", target: SLACK });
    actAs(t.acme.member);
    expect((await patch({ id: body.channel.id, enabled: false })).status).toBe(403);
  });

  it("renames and disables", async () => {
    const { body } = await create({ kind: "slack", label: "x", target: SLACK });
    const updated = await patch({ id: body.channel.id, label: "Renamed", enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.channel).toMatchObject({ label: "Renamed", enabled: false });
  });

  it("validates a new destination against the channel's kind", async () => {
    const { body } = await create({ kind: "slack", label: "x", target: SLACK });
    expect((await patch({ id: body.channel.id, target: "https://discord.com/api/webhooks/1" })).status).toBe(400);
  });

  it("cannot change another organization's channel", async () => {
    expect((await patch({ id: theirChannel, label: "Mine" })).status).toBe(404);
  });
});

describe("DELETE /api/alerts/channels", () => {
  it("is refused to a member", async () => {
    const { body } = await create({ kind: "slack", label: "x", target: SLACK });
    actAs(t.acme.member);
    expect((await remove(body.channel.id)).status).toBe(403);
  });

  it("requires an id", async () => {
    expect((await remove()).status).toBe(400);
  });

  it("removes its own channel", async () => {
    const { body } = await create({ kind: "slack", label: "x", target: SLACK });
    expect((await remove(body.channel.id)).status).toBe(200);
    expect((await remove(body.channel.id)).status).toBe(404);
  });

  it("cannot remove another organization's channel", async () => {
    expect((await remove(theirChannel)).status).toBe(404);
    expect(await (await reposFor(t.other.owner)).channels.get(theirChannel)).toBeTruthy();
  });
});
