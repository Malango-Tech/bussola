import type { MemberRole } from "@/lib/auth/roles";
import type { Provider } from "@/lib/providers";
import type { TestDb } from "./db";

/**
 * Who a route test is signed in as.
 *
 * A test file replaces `@/lib/auth/tenant` with `mockTenantModule`, whose
 * session functions answer for whoever `actAs` last named — or for nobody.
 * Everything below the session is real: `forTenant` builds the same
 * organization-scoped repositories a signed-in request gets, so a test that
 * passes here has exercised the real tenant filter and the real role check in
 * `withTenant`. Only Better Auth's cookie lookup is skipped.
 *
 *   vi.mock("@/lib/auth/tenant", async (importOriginal) =>
 *     (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
 *   );
 */
export type Actor = {
  organizationId: string;
  userId: string;
  role: MemberRole;
  email: string;
  name: string;
};

let current: Actor | null = null;

/** Sign in as someone for the requests that follow, or sign out with null. */
export function actAs(actor: Actor | null) {
  current = actor;
}

type TenantModule = typeof import("@/lib/auth/tenant");

export function mockTenantModule(actual: TenantModule): TenantModule {
  const getSession: TenantModule["getSession"] = async () =>
    current
      ? {
          user: { id: current.userId, email: current.email, name: current.name },
          organizationId: current.organizationId,
          role: current.role,
        }
      : null;

  const getTenant: TenantModule["getTenant"] = async () => {
    if (!current) return null;
    const { forTenant } = await import("@/lib/db/tenant");
    return forTenant({
      organizationId: current.organizationId,
      userId: current.userId,
      role: current.role,
    });
  };

  const requireTenant: TenantModule["requireTenant"] = async () => {
    const repos = await getTenant();
    if (!repos) throw new actual.UnauthorizedError();
    return repos;
  };

  return {
    ...actual,
    getSession,
    getTenant,
    requireTenant,
    requirePageTenant: requireTenant,
  };
}

/** Repositories for an actor, for seeding and for checking what a route did. */
export async function reposFor(actor: Actor) {
  const { forTenant } = await import("@/lib/db/tenant");
  return forTenant({
    organizationId: actor.organizationId,
    userId: actor.userId,
    role: actor.role,
  });
}

/** A stored connection with placeholder credentials, never tested. */
export async function seedConnection(
  actor: Actor,
  provider: Provider,
  label: string = provider,
) {
  const { encryptSecret } = await import("@/lib/crypto/vault");
  const repos = await reposFor(actor);
  return repos.connections.create({
    provider,
    label,
    credentialsEncrypted: encryptSecret(JSON.stringify({ apiKey: "test-key" })),
  });
}

/**
 * Two organizations: Acme with one person at every role, and Other with an
 * owner — whose rows are what "another tenant's id" means in every test.
 */
export async function seedTenants(testDb: TestDb) {
  const acmeId = await testDb.organization("Acme");
  const otherId = await testDb.organization("Other");

  const actor = async (
    organizationId: string,
    role: MemberRole,
  ): Promise<Actor> => {
    const person = await testDb.person(organizationId, role);
    return {
      organizationId,
      userId: person.userId,
      role,
      email: person.email,
      name: person.name,
    };
  };

  return {
    acme: {
      id: acmeId,
      owner: await actor(acmeId, "owner"),
      admin: await actor(acmeId, "admin"),
      member: await actor(acmeId, "member"),
    },
    other: {
      id: otherId,
      owner: await actor(otherId, "owner"),
    },
  };
}

export type Tenants = Awaited<ReturnType<typeof seedTenants>>;
