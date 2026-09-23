import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read, request } from "@/test/http";
import { actAs, reposFor, seedTenants, type Tenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

type Member = { id: string; userId: string; role: string; isYou: boolean };

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;

const remove = (memberId?: string) =>
  read(
    route.DELETE(
      request(`/api/members${memberId ? `?memberId=${memberId}` : ""}`, { method: "DELETE" }),
    ),
  );

/** The member row id behind an actor, as the roster reports it. */
async function memberIdOf(userId: string, organizationActor = t.acme.owner) {
  const members = await (await reposFor(organizationActor)).members.list();
  return members.find((member) => member.userId === userId)!.id;
}

beforeAll(async () => {
  testDb = await startTestDb("members-route");
  t = await seedTenants(testDb);
  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => actAs(t.acme.admin));

describe("GET /api/members", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await route.GET()).status).toBe(401);
  });

  it("shows a member the roster, their own role and the seat count", async () => {
    actAs(t.acme.member);
    const { status, body } = await read<{
      members: Member[];
      yourRole: string;
      seats: { used: number; included: number | null };
    }>(route.GET());
    expect(status).toBe(200);
    expect(body.yourRole).toBe("member");
    expect(body.members.map((member) => member.role).sort()).toEqual(["admin", "member", "owner"]);
    expect(body.members.find((member) => member.isYou)?.userId).toBe(t.acme.member.userId);
    expect(body.members.map((member) => member.userId)).not.toContain(t.other.owner.userId);
    expect(body.seats).toEqual({ used: 3, included: null });
  });
});

describe("DELETE /api/members", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await remove("anything")).status).toBe(401);
  });

  it("is refused to a member", async () => {
    actAs(t.acme.member);
    const { status, body } = await remove(await memberIdOf(t.acme.admin.userId));
    expect(status).toBe(403);
    expect(body.error).toMatch(/owner or admin/);
  });

  it("requires a member id", async () => {
    expect((await remove()).status).toBe(400);
  });

  it("does not let an admin remove an owner", async () => {
    const { status, body } = await remove(await memberIdOf(t.acme.owner.userId));
    expect(status).toBe(403);
    expect(body.error).toBe("Only an owner can remove another owner.");
  });

  it("does not let the only owner leave the organization ownerless", async () => {
    actAs(t.acme.owner);
    const { status } = await remove(await memberIdOf(t.acme.owner.userId));
    expect(status).toBe(409);
  });

  it("cannot remove someone from another organization", async () => {
    const theirs = await memberIdOf(t.other.owner.userId, t.other.owner);
    expect((await remove(theirs)).status).toBe(404);
    expect(await (await reposFor(t.other.owner)).members.roleOf(t.other.owner.userId)).toBe("owner");
  });

  it("lets an admin remove a member", async () => {
    const person = await testDb.person(t.acme.id, "member", "leaver");
    const { status } = await remove(await memberIdOf(person.userId));
    expect(status).toBe(200);
    expect(await (await reposFor(t.acme.owner)).members.roleOf(person.userId)).toBeNull();
  });
});
