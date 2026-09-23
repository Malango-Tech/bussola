import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read, request } from "@/test/http";
import { actAs, seedTenants, type Tenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

/*
 * Checkout and the portal are covered here only up to the role gate. Past it
 * they talk to Stripe, which this edition never configures — so an owner
 * reaching "billing is not enabled" is exactly the proof that the gate let
 * them through, without a single request leaving the machine.
 */
let billing: typeof import("./route");
let checkout: typeof import("./checkout/route");
let portal: typeof import("./portal/route");
let testDb: TestDb;
let t: Tenants;

const startCheckout = () =>
  read(
    checkout.POST(
      request("/api/billing/checkout", { method: "POST", body: { plan: "team" } }),
    ),
  );

beforeAll(async () => {
  testDb = await startTestDb("billing-route");
  t = await seedTenants(testDb);
  billing = await import("./route");
  checkout = await import("./checkout/route");
  portal = await import("./portal/route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => actAs(t.acme.member));

describe("GET /api/billing", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await billing.GET()).status).toBe(401);
  });

  it("shows any member the plan and this organization's usage", async () => {
    const { status, body } = await read<{
      enabled: boolean;
      planName: string;
      usage: { seats: number; connections: number; dashboards: number };
      limits: { seats: number | null };
    }>(billing.GET());
    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.planName).toBe("Self-hosted");
    // Three people in Acme; Other's owner is not counted.
    expect(body.usage).toEqual({ seats: 3, connections: 0, dashboards: 0 });
    // Unlimited survives JSON as null rather than vanishing.
    expect(body.limits.seats).toBeNull();
  });
});

describe("POST /api/billing/checkout", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await startCheckout()).status).toBe(401);
  });

  it("is refused to a member and to an admin", async () => {
    for (const actor of [t.acme.member, t.acme.admin]) {
      actAs(actor);
      const { status, body } = await startCheckout();
      expect(status).toBe(403);
      expect(body.error).toBe("Only an owner of this organization can do that.");
    }
  });

  it("lets an owner through the gate", async () => {
    actAs(t.acme.owner);
    const { status, body } = await startCheckout();
    expect(status).toBe(404);
    expect(body.error).toBe("Billing is not enabled on this deployment");
  });
});

describe("POST /api/billing/portal", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await portal.POST()).status).toBe(401);
  });

  it("is refused to a member and to an admin", async () => {
    for (const actor of [t.acme.member, t.acme.admin]) {
      actAs(actor);
      expect((await portal.POST()).status).toBe(403);
    }
  });

  it("lets an owner through the gate", async () => {
    actAs(t.acme.owner);
    const { status, body } = await read(portal.POST());
    expect(status).toBe(404);
    expect(body.error).toBe("Billing is not enabled on this deployment");
  });
});
