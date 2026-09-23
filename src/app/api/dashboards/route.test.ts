import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read, request } from "@/test/http";
import { actAs, reposFor, seedTenants, type Tenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

type Route = typeof import("./route");

let route: Route;
let testDb: TestDb;
let t: Tenants;
let otherDashboard: string;

beforeAll(async () => {
  testDb = await startTestDb("dashboards-route");
  t = await seedTenants(testDb);
  otherDashboard = (await (await reposFor(t.other.owner)).dashboards.create("Theirs")).id;
  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => actAs(t.acme.member));

describe("/api/dashboards", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await route.GET()).status).toBe(401);
    expect((await route.POST(request("/api/dashboards", { method: "POST", body: { name: "x" } }))).status).toBe(401);
    expect((await route.DELETE(request("/api/dashboards?id=x", { method: "DELETE" }))).status).toBe(401);
  });

  it("lets any member create a dashboard, and lists only their organization's", async () => {
    const created = await read<{ dashboard: { id: string; name: string } }>(
      route.POST(request("/api/dashboards", { method: "POST", body: { name: "Ops" } })),
    );
    expect(created.status).toBe(201);
    expect(created.body.dashboard.name).toBe("Ops");

    const { status, body } = await read<{ dashboards: Array<{ id: string }> }>(route.GET());
    expect(status).toBe(200);
    const ids = body.dashboards.map((dashboard) => dashboard.id);
    expect(ids).toContain(created.body.dashboard.id);
    expect(ids).not.toContain(otherDashboard);
  });

  it("rejects a missing or empty name", async () => {
    for (const body of [{}, { name: "" }, { name: "x".repeat(81) }]) {
      const res = await read(route.POST(request("/api/dashboards", { method: "POST", body })));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Name required");
    }
    const malformed = await route.POST(
      request("/api/dashboards", { method: "POST", body: "{not json" }),
    );
    expect(malformed.status).toBe(400);
  });

  it("requires an id to delete", async () => {
    expect((await route.DELETE(request("/api/dashboards", { method: "DELETE" }))).status).toBe(400);
  });

  it("cannot delete another organization's dashboard", async () => {
    const res = await route.DELETE(
      request(`/api/dashboards?id=${otherDashboard}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
    expect(await (await reposFor(t.other.owner)).dashboards.get(otherDashboard)).toBeTruthy();
  });

  it("deletes its own", async () => {
    const { id } = await (await reposFor(t.acme.owner)).dashboards.create("Doomed");
    const res = await route.DELETE(request(`/api/dashboards?id=${id}`, { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await (await reposFor(t.acme.owner)).dashboards.get(id)).toBeNull();
  });
});
