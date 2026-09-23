import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/lib/db";
import { forTenant, type TenantContext, type TenantRepos } from "@/lib/db/tenant";
import { resolveSessionMembership } from "./membership";
import type { MemberRole } from "./roles";
import { getAuth } from ".";

export class UnauthorizedError extends Error {
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

/**
 * The verified identity behind the current request, or null.
 *
 * The organization and role come from the membership table on every request,
 * never from the session row alone — see `resolveSessionMembership`.
 */
export async function getSession(): Promise<{
  user: SessionUser;
  organizationId: string;
  role: MemberRole;
} | null> {
  const auth = await getAuth();
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result) return null;

  const membership = await resolveSessionMembership({
    userId: result.user.id,
    sessionId: result.session.id,
    activeOrganizationId: result.session.activeOrganizationId,
  });
  if (!membership) return null;

  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
    },
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

/**
 * The single entry point from a request to tenant data.
 *
 * Identical in both editions: self-hosted resolves to the one organization
 * created when the instance was claimed, cloud to whichever organization the
 * session is acting in. Route handlers never see an organization id they did
 * not get from here.
 */
export async function getTenant(): Promise<TenantRepos | null> {
  const session = await getSession();
  if (!session) return null;
  return forTenant({
    organizationId: session.organizationId,
    userId: session.user.id,
    role: session.role,
  });
}

/**
 * For route handlers: throws, so `withTenant` can answer 401.
 */
export async function requireTenant(): Promise<TenantRepos> {
  const repos = await getTenant();
  if (!repos) throw new UnauthorizedError();
  return repos;
}

/**
 * For pages: redirects to the login screen instead of throwing.
 *
 * A page and its layout render in parallel, so a page that throws races the
 * layout's own redirect and logs an unhandled error on every anonymous request
 * even though the user ends up in the right place. Redirecting from both is
 * quiet and has the same outcome.
 */
export async function requirePageTenant(): Promise<TenantRepos> {
  const repos = await getTenant();
  if (!repos) redirect("/login");
  return repos;
}

/** True once this instance has been claimed. Self-hosted setup gate. */
export async function hasAccount(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select({ id: schema.user.id }).from(schema.user).limit(1);
  return rows.length > 0;
}

export type { MemberRole, TenantContext, TenantRepos };
