import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read, request } from "@/test/http";
import { actAs, reposFor, seedTenants, type Tenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

type ApiToken = { id: string; name: string; scope: string; revokedAt: string | null };

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let theirToken: string;

const create = (body: unknown) =>
  read<{ apiToken: ApiToken; token: string }>(
    route.POST(request("/api/tokens", { method: "POST", body })),
  );
const revoke = (id?: string) =>
  read(route.DELETE(request(`/api/tokens${id ? `?id=${id}` : ""}`, { method: "DELETE" })));

beforeAll(async () => {
  testDb = await startTestDb("tokens-route");
  t = await seedTenants(testDb);
  theirToken = (
    await (await reposFor(t.other.owner)).apiTokens.create({
      name: "Their agent",
      tokenHash: "hash",
      tokenPrefix: "bsk_abc",
      scope: "read",
      expiresAt: null,
    })
  ).id;
  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => actAs(t.acme.admin));

describe("GET /api/tokens", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await route.GET()).status).toBe(401);
  });

  it("lets a member see this organization's tokens, never their hashes", async () => {
    await create({ name: "Desk" });
    actAs(t.acme.member);
    const { status, body } = await read<{ tokens: ApiToken[]; canUseMcp: boolean }>(route.GET());
    expect(status).toBe(200);
    expect(body.canUseMcp).toBe(true);
    expect(body.tokens.map((token) => token.name)).toContain("Desk");
    expect(body.tokens.map((token) => token.id)).not.toContain(theirToken);
    for (const token of body.tokens) expect(token).not.toHaveProperty("tokenHash");
  });
});

describe("POST /api/tokens", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await create({ name: "x" })).status).toBe(401);
  });

  it("is refused to a member", async () => {
    actAs(t.acme.member);
    const { status, body } = await create({ name: "x" });
    expect(status).toBe(403);
    expect(body.error).toMatch(/owner or admin/);
  });

  it("mints a read-only token by default, shown once", async () => {
    const { status, body } = await create({ name: " Claude ", expiresInDays: 30 });
    expect(status).toBe(201);
    expect(body.token).toMatch(/^bsk_/);
    expect(body.apiToken).toMatchObject({ name: "Claude", scope: "read" });
    expect(body.apiToken).not.toHaveProperty("tokenHash");
  });

  it("rejects an invalid payload", async () => {
    expect((await create({})).status).toBe(400);
    expect((await create({ name: "x", scope: "admin" })).status).toBe(400);
    expect((await create({ name: "x", expiresInDays: 400 })).status).toBe(400);
  });
});

describe("DELETE /api/tokens", () => {
  it("is refused to a member", async () => {
    const { body } = await create({ name: "x" });
    actAs(t.acme.member);
    expect((await revoke(body.apiToken.id)).status).toBe(403);
  });

  it("requires an id", async () => {
    expect((await revoke()).status).toBe(400);
  });

  it("revokes once", async () => {
    const { body } = await create({ name: "x" });
    expect((await revoke(body.apiToken.id)).status).toBe(200);
    expect((await revoke(body.apiToken.id)).status).toBe(404);
  });

  it("cannot revoke another organization's token", async () => {
    expect((await revoke(theirToken)).status).toBe(404);
    const [still] = await (await reposFor(t.other.owner)).apiTokens.list();
    expect(still?.revokedAt).toBeNull();
  });
});
