import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { params, read, request } from "@/test/http";
import { actAs, reposFor, seedTenants, type Tenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

type Share = { id: string; tokenPrefix: string; revokedAt: string | null };

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let ours: string;
let theirs: string;
let theirShare: string;

const url = (id: string, query = "") => `/api/dashboards/${id}/shares${query}`;

const list = (id: string) =>
  read<{ shares: Share[]; canShare: boolean }>(route.GET(request(url(id)), params({ id })));
const create = (id: string, body: unknown = {}) =>
  read<{ share: Share; token: string }>(
    route.POST(request(url(id), { method: "POST", body }), params({ id })),
  );
const revoke = (id: string, shareId?: string) =>
  read<{ share: Share }>(
    route.DELETE(
      request(url(id, shareId ? `?shareId=${shareId}` : ""), { method: "DELETE" }),
      params({ id }),
    ),
  );

beforeAll(async () => {
  testDb = await startTestDb("shares-route");
  t = await seedTenants(testDb);
  ours = (await (await reposFor(t.acme.owner)).dashboards.create("Ours")).id;

  const other = await reposFor(t.other.owner);
  theirs = (await other.dashboards.create("Theirs")).id;
  theirShare = (
    await other.shares.create({
      dashboardId: theirs,
      tokenHash: "hash",
      tokenPrefix: "shr_abc",
      label: null,
      whiteLabel: false,
      expiresAt: null,
    })
  ).id;

  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => actAs(t.acme.admin));

describe("GET /api/dashboards/[id]/shares", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await list(ours)).status).toBe(401);
  });

  it("lets a member see the links, never their hashes", async () => {
    await create(ours, { label: "Board" });
    actAs(t.acme.member);
    const { status, body } = await list(ours);
    expect(status).toBe(200);
    expect(body.canShare).toBe(true);
    expect(body.shares.length).toBeGreaterThan(0);
    for (const share of body.shares) expect(share).not.toHaveProperty("tokenHash");
  });

  it("does not list another organization's links", async () => {
    expect((await list(theirs)).status).toBe(404);
  });
});

describe("POST /api/dashboards/[id]/shares", () => {
  it("is refused to a member", async () => {
    actAs(t.acme.member);
    const { status, body } = await create(ours);
    expect(status).toBe(403);
    expect(body.error).toMatch(/owner or admin/);
  });

  it("mints a link for an admin, returning the token exactly once", async () => {
    const { status, body } = await create(ours, { label: "Investors", expiresInDays: 7 });
    expect(status).toBe(201);
    expect(body.token).toMatch(/^shr_/);
    expect(body.token.startsWith(body.share.tokenPrefix)).toBe(true);

    const listed = await list(ours);
    expect(JSON.stringify(listed.body)).not.toContain(body.token);
  });

  it("rejects an invalid payload", async () => {
    expect((await create(ours, { expiresInDays: 0 })).status).toBe(400);
    expect((await create(ours, { label: "x".repeat(81) })).status).toBe(400);
  });

  it("cannot share another organization's dashboard", async () => {
    expect((await create(theirs)).status).toBe(404);
  });
});

describe("DELETE /api/dashboards/[id]/shares", () => {
  it("is refused to a member", async () => {
    const { body } = await create(ours);
    actAs(t.acme.member);
    expect((await revoke(ours, body.share.id)).status).toBe(403);
  });

  it("requires a share id", async () => {
    expect((await revoke(ours)).status).toBe(400);
  });

  it("revokes once", async () => {
    const { body } = await create(ours);
    const first = await revoke(ours, body.share.id);
    expect(first.status).toBe(200);
    expect(first.body.share.revokedAt).not.toBeNull();
    expect((await revoke(ours, body.share.id)).status).toBe(404);
  });

  it("cannot revoke another organization's link", async () => {
    expect((await revoke(ours, theirShare)).status).toBe(404);
    expect((await revoke(theirs, theirShare)).status).toBe(404);
    const [still] = await (await reposFor(t.other.owner)).shares.listFor(theirs);
    expect(still?.revokedAt).toBeNull();
  });
});
