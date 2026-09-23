import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read } from "@/test/http";
import { actAs, seedTenants } from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

type Status = {
  edition: string;
  signupOpen: boolean;
  claimed: boolean;
  authenticated: boolean;
  user: { id: string; email: string } | null;
};

/*
 * The one endpoint an anonymous visitor may call: it decides whether the
 * login screen offers "claim this instance". It must say that honestly
 * before and after the first account, and never describe anyone else.
 */
let route: typeof import("./route");
let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb("status-route");
  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

describe("GET /api/status", () => {
  it("offers to claim a fresh self-hosted instance", async () => {
    actAs(null);
    const { status, body } = await read<Status>(route.GET());
    expect(status).toBe(200);
    expect(body).toMatchObject({
      edition: "self-hosted",
      claimed: false,
      signupOpen: true,
      authenticated: false,
      user: null,
    });
  });

  it("closes signup once claimed, and describes only the caller", async () => {
    const t = await seedTenants(testDb);

    actAs(null);
    const anonymous = await read<Status>(route.GET());
    expect(anonymous.body).toMatchObject({
      claimed: true,
      signupOpen: false,
      authenticated: false,
      user: null,
    });

    actAs(t.acme.member);
    const signedIn = await read<Status>(route.GET());
    expect(signedIn.body.authenticated).toBe(true);
    expect(signedIn.body.user).toEqual({
      id: t.acme.member.userId,
      email: t.acme.member.email,
      name: t.acme.member.name,
    });
  });
});
