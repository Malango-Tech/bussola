import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { params, read, request } from "@/test/http";
import { actAs, seedConnection, seedTenants, type Tenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

// The sync itself — the provider call, the snapshot write — belongs to the
// runner's suite. What this route owns is who may trigger it, and for what.
const syncNow = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sync/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/runner")>()),
  syncNow,
}));

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let ours: string;
let theirs: string;

const sync = (id: string) =>
  read<{ ok: boolean; error: string | null; disabled: boolean }>(
    route.POST(request(`/api/connections/${id}/sync`, { method: "POST" }), params({ id })),
  );

beforeAll(async () => {
  testDb = await startTestDb("connection-sync-route");
  t = await seedTenants(testDb);
  ours = (await seedConnection(t.acme.owner, "vercel")).id;
  theirs = (await seedConnection(t.other.owner, "vercel")).id;
  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => {
  actAs(t.acme.member);
  syncNow.mockReset();
});

describe("POST /api/connections/[id]/sync", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await sync(ours)).status).toBe(401);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it("lets a member refresh, and reports the outcome", async () => {
    syncNow.mockResolvedValue({ connectionId: ours, provider: "vercel", ok: true });
    const { status, body } = await sync(ours);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, error: null, disabled: false });
    expect(syncNow).toHaveBeenCalledWith(ours);
  });

  it("passes a failed sync through, including a connection it gave up on", async () => {
    syncNow.mockResolvedValue({
      connectionId: ours,
      provider: "vercel",
      ok: false,
      error: "Vercel API 401",
      disabled: true,
    });
    const { body } = await sync(ours);
    expect(body).toEqual({ ok: false, error: "Vercel API 401", disabled: true });
  });

  it("never drives traffic for another organization's connection", async () => {
    expect((await sync(theirs)).status).toBe(404);
    expect(syncNow).not.toHaveBeenCalled();
  });
});
