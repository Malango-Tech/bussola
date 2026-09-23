import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { params, read, request } from "@/test/http";
import { actAs, reposFor, seedTenants, type Tenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let ours: string;
let theirs: string;

const get = (id: string) => route.GET(request(`/api/dashboards/${id}`), params({ id }));
const patch = (id: string, body: unknown) =>
  route.PATCH(request(`/api/dashboards/${id}`, { method: "PATCH", body }), params({ id }));

beforeAll(async () => {
  testDb = await startTestDb("dashboard-route");
  t = await seedTenants(testDb);

  const acme = await reposFor(t.acme.owner);
  ours = (await acme.dashboards.create("Ours")).id;
  await acme.widgets.add({
    dashboardId: ours,
    widgetType: "stripe-mrr",
    title: "MRR",
    configJson: "{}",
    connectionId: null,
    layoutY: 0,
    layoutW: 4,
    layoutH: 3,
  });
  theirs = (await (await reposFor(t.other.owner)).dashboards.create("Theirs")).id;

  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => actAs(t.acme.member));

describe("GET /api/dashboards/[id]", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await get(ours)).status).toBe(401);
  });

  it("returns the dashboard with its widgets", async () => {
    const { status, body } = await read<{
      dashboard: { id: string };
      widgets: Array<{ widgetType: string; title: string }>;
    }>(get(ours));
    expect(status).toBe(200);
    expect(body.dashboard.id).toBe(ours);
    expect(body.widgets).toEqual([
      expect.objectContaining({ widgetType: "stripe-mrr", title: "MRR" }),
    ]);
  });

  it("does not reveal another organization's dashboard", async () => {
    expect((await get(theirs)).status).toBe(404);
  });
});

describe("PATCH /api/dashboards/[id]", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await patch(ours, { name: "x" })).status).toBe(401);
  });

  it("renames", async () => {
    const { status, body } = await read<{ dashboard: { name: string } }>(
      patch(ours, { name: "Renamed" }),
    );
    expect(status).toBe(200);
    expect(body.dashboard.name).toBe("Renamed");
  });

  it("rejects an invalid name", async () => {
    expect((await patch(ours, { name: "" })).status).toBe(400);
    expect((await patch(ours, { name: 7 })).status).toBe(400);
  });

  it("cannot rename another organization's dashboard", async () => {
    expect((await patch(theirs, { name: "Mine now" })).status).toBe(404);
    const still = await (await reposFor(t.other.owner)).dashboards.get(theirs);
    expect(still?.name).toBe("Theirs");
  });
});
