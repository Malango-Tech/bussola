import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read, request } from "@/test/http";
import { actAs, reposFor, seedTenants, type Tenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

// Delivery is the one thing that would leave the machine; its formatting and
// retries are the deliver suite's concern. This route owns who may send, how
// often, and that the outcome is recorded.
const deliver = vi.hoisted(() => vi.fn());
vi.mock("@/lib/alerts/deliver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alerts/deliver")>()),
  deliver,
}));

const SLACK = "https://hooks.slack.com/services/T000/B000/secret";

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let ours: string;
let theirs: string;
let resetRateLimits: () => void;

const sendTest = (body: unknown) =>
  read<{ ok: boolean }>(
    route.POST(request("/api/alerts/channels/test", { method: "POST", body })),
  );

beforeAll(async () => {
  testDb = await startTestDb("channel-test-route");
  t = await seedTenants(testDb);
  const { encryptSecret } = await import("@/lib/crypto/vault");
  ({ resetRateLimits } = await import("@/lib/http/rate-limit"));

  const channel = { kind: "slack" as const, label: "Ops", targetEncrypted: encryptSecret(SLACK) };
  ours = (await (await reposFor(t.acme.owner)).channels.create(channel)).id;
  theirs = (await (await reposFor(t.other.owner)).channels.create(channel)).id;

  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => {
  actAs(t.acme.admin);
  resetRateLimits();
  deliver.mockReset();
  deliver.mockResolvedValue({ ok: true });
});

describe("POST /api/alerts/channels/test", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await sendTest({ id: ours })).status).toBe(401);
  });

  it("is refused to a member, before anything is sent", async () => {
    actAs(t.acme.member);
    expect((await sendTest({ id: ours })).status).toBe(403);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload", async () => {
    expect((await sendTest({})).status).toBe(400);
  });

  it("sends to the decrypted destination and records the delivery", async () => {
    const { status, body } = await sendTest({ id: ours });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ id: ours, target: SLACK }),
      expect.objectContaining({ state: "ok" }),
    );
    const row = await (await reposFor(t.acme.owner)).channels.get(ours);
    expect(row?.lastDeliveredAt).toBeTruthy();
  });

  it("reports a refused delivery as a result, not an error", async () => {
    deliver.mockResolvedValue({ ok: false, error: "Slack answered 404" });
    const { status, body } = await sendTest({ id: ours });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: false, error: "Slack answered 404" });
  });

  it("cannot send through another organization's channel", async () => {
    expect((await sendTest({ id: theirs })).status).toBe(404);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("meters test sends per organization", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await sendTest({ id: ours })).status).toBe(200);
    }
    const limited = await sendTest({ id: ours });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/Too many test sends/);

    // Another organization's budget is its own.
    actAs(t.other.owner);
    expect((await sendTest({ id: theirs })).status).toBe(200);
  });
});
