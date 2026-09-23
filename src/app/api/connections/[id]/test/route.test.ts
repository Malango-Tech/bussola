import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { params, read, request } from "@/test/http";
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

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let ours: string;
let theirs: string;

const fetchSpy = vi.fn<typeof fetch>();

const test = (id: string) =>
  read<{ result: { ok: boolean; message: string } }>(
    route.POST(request(`/api/connections/${id}/test`, { method: "POST" }), params({ id })),
  );

beforeAll(async () => {
  testDb = await startTestDb("connection-test-route");
  t = await seedTenants(testDb);
  ours = (await seedConnection(t.acme.owner, "resend")).id;
  theirs = (await seedConnection(t.other.owner, "resend")).id;
  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => {
  actAs(t.acme.member);
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/connections/[id]/test", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await test(ours)).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lets a member re-test, and records a pass on the connection", async () => {
    fetchSpy.mockResolvedValue(Response.json({ data: [{ id: "d1" }] }));
    const { status, body } = await test(ours);
    expect(status).toBe(200);
    expect(body.result).toEqual({ ok: true, message: "Connected to Resend (1 domain)" });
    const row = await (await reposFor(t.acme.owner)).connections.get(ours);
    expect(row?.status).toBe("connected");
  });

  it("reports and records a refusal from the provider", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 401 }));
    const { status, body } = await test(ours);
    expect(status).toBe(200);
    expect(body.result.ok).toBe(false);
    const row = await (await reposFor(t.acme.owner)).connections.get(ours);
    expect(row?.status).toBe("error");
    expect(row?.lastError).toBe(body.result.message);
  });

  it("does not test another organization's connection", async () => {
    const { status } = await test(theirs);
    expect(status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
