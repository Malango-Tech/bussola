import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// A successful test fills the snapshot straight away; that is the sync
// runner's job and its own suite's concern, so here it only records the call.
const syncNow = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sync/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/runner")>()),
  syncNow,
}));

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let theirs: string;

const post = (body: unknown) =>
  read<{ id: string; testResult: { ok: boolean; message: string } | null }>(
    route.POST(request("/api/connections", { method: "POST", body })),
  );
const remove = (id?: string) =>
  read(route.DELETE(request(`/api/connections${id ? `?id=${id}` : ""}`, { method: "DELETE" })));

/** Stand in for the provider's API, so "test the credentials" never leaves the machine. */
function providerAnswers(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeAll(async () => {
  testDb = await startTestDb("connections-route");
  t = await seedTenants(testDb);
  theirs = (await seedConnection(t.other.owner, "resend", "Their Resend")).id;
  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => {
  actAs(t.acme.admin);
  syncNow.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/connections", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await route.GET()).status).toBe(401);
  });

  it("lists this organization's connections to a member, without credentials", async () => {
    const ours = await seedConnection(t.acme.owner, "vercel", "Our Vercel");
    actAs(t.acme.member);
    const { status, body } = await read<{ connections: Array<{ id: string }> }>(route.GET());
    expect(status).toBe(200);
    const ids = body.connections.map((connection) => connection.id);
    expect(ids).toContain(ours.id);
    expect(ids).not.toContain(theirs);
    expect(JSON.stringify(body)).not.toMatch(/credentials|test-key/i);
  });
});

describe("POST /api/connections", () => {
  const resend = { provider: "resend", label: "Resend", credentials: { apiKey: "re_123" } };

  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await post(resend)).status).toBe(401);
  });

  it("is refused to a member", async () => {
    actAs(t.acme.member);
    const { status, body } = await post(resend);
    expect(status).toBe(403);
    expect(body.error).toBe("Only an owner or admin of this organization can do that.");
  });

  it("rejects an invalid payload", async () => {
    expect((await post({ ...resend, provider: "myspace" })).status).toBe(400);
    expect((await post({ ...resend, label: "" })).status).toBe(400);
    expect((await post({ provider: "resend", label: "x" })).status).toBe(400);
  });

  it("saves without testing when asked not to", async () => {
    const { status, body } = await post({ ...resend, test: false });
    expect(status).toBe(200);
    expect(body.testResult).toBeNull();
    expect(syncNow).not.toHaveBeenCalled();
    const stored = await (await reposFor(t.acme.owner)).connections.get(body.id);
    expect(stored?.credentialsEncrypted).not.toContain("re_123");
  });

  it("tests the credentials and syncs straight away when they work", async () => {
    providerAnswers(200, { data: [] });
    const { status, body } = await post(resend);
    expect(status).toBe(200);
    expect(body.testResult).toMatchObject({ ok: true });
    expect(syncNow).toHaveBeenCalledWith(body.id);
  });

  it("saves but reports credentials the provider refuses, without syncing", async () => {
    providerAnswers(401, { message: "invalid key" });
    const { status, body } = await post(resend);
    expect(status).toBe(200);
    expect(body.testResult?.ok).toBe(false);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it("cannot overwrite another organization's connection", async () => {
    const { status } = await post({ ...resend, id: theirs, test: false });
    expect(status).toBe(404);
    const still = await (await reposFor(t.other.owner)).connections.get(theirs);
    expect(still?.label).toBe("Their Resend");
  });
});

describe("DELETE /api/connections", () => {
  it("is refused to a member", async () => {
    const ours = await seedConnection(t.acme.owner, "sentry");
    actAs(t.acme.member);
    expect((await remove(ours.id)).status).toBe(403);
  });

  it("requires an id", async () => {
    expect((await remove()).status).toBe(400);
  });

  it("removes its own connection", async () => {
    const ours = await seedConnection(t.acme.owner, "sentry");
    expect((await remove(ours.id)).status).toBe(200);
    expect(await (await reposFor(t.acme.owner)).connections.get(ours.id)).toBeFalsy();
  });

  it("cannot remove another organization's connection", async () => {
    expect((await remove(theirs)).status).toBe(404);
    expect(await (await reposFor(t.other.owner)).connections.get(theirs)).toBeTruthy();
  });
});
