import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read, request } from "@/test/http";
import { actAs, seedConnection, seedTenants, type Tenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

/** A current-format Qonto snapshot, so nothing tries to re-sync it. */
const snapshot = (accountName: string) => ({
  _v: 1,
  balances: [{ accountName, balance: 1000, currency: "EUR" }],
  liquidity: { currency: "EUR", booked: 1000, available: 900 },
  cashflow30d: { currency: "EUR", inflow: 5000, outflow: 4000 },
  balanceHistory: { currency: "EUR", days: 30, points: [] },
});

type Payload = {
  balances?: Array<{ accountName: string }>;
  _demo?: boolean;
  _sync?: { connectionId: string };
};

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let ours: string;
let theirs: string;

const data = (query: string) =>
  read<Payload>(route.GET(request(`/api/widgets/data${query}`)));

beforeAll(async () => {
  testDb = await startTestDb("widget-data-route");
  t = await seedTenants(testDb);
  ours = (await seedConnection(t.acme.owner, "qonto")).id;
  await testDb.snapshot(t.acme.id, ours, snapshot("Acme main"));
  theirs = (await seedConnection(t.other.owner, "qonto")).id;
  await testDb.snapshot(t.other.id, theirs, snapshot("Other main"));
  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => actAs(t.acme.member));

describe("GET /api/widgets/data", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await data("?type=qonto-balance")).status).toBe(401);
  });

  it("requires a widget type", async () => {
    expect((await data("")).status).toBe(400);
  });

  it("serves the organization's default connection from its snapshot", async () => {
    const { status, body } = await data("?type=qonto-balance");
    expect(status).toBe(200);
    expect(body.balances?.[0]?.accountName).toBe("Acme main");
    expect(body._sync?.connectionId).toBe(ours);
  });

  it("serves a named connection of its own", async () => {
    const { status, body } = await data(`?type=qonto-balance&connectionId=${ours}`);
    expect(status).toBe(200);
    expect(body._sync?.connectionId).toBe(ours);
  });

  it("never serves another organization's connection", async () => {
    const { status, body } = await data(`?type=qonto-balance&connectionId=${theirs}`);
    expect(status).toBe(404);
    expect(JSON.stringify(body)).not.toContain("Other main");
  });

  it("falls back to demo data for a source that is not connected", async () => {
    const { status, body } = await data("?type=stripe-mrr");
    expect(status).toBe(200);
    expect(body._demo).toBe(true);
  });
});
