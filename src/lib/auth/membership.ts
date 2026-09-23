import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { toMemberRole, type MemberRole } from "./roles";

/**
 * Which organization a session acts in, and as what — re-read on every request.
 *
 * The session row names an active organization, but it is not trusted on its
 * own: sessions last thirty days and slide forward with use, so trusting the
 * stored organization would let someone removed from a team keep reading its
 * data for as long as they kept the tab open. The membership table is the only
 * authority on who belongs where.
 *
 * A session with no active organization (one opened during sign-up, before
 * the organization existed) or one whose organization the user has left falls
 * back to the user's oldest remaining membership, and that is written back so
 * the correction happens once. No membership at all means no tenant.
 */
export async function resolveSessionMembership(input: {
  userId: string;
  sessionId: string;
  activeOrganizationId: string | null | undefined;
}): Promise<{ organizationId: string; role: MemberRole } | null> {
  const db = await getDb();
  const memberships = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(eq(schema.member.userId, input.userId))
    .orderBy(asc(schema.member.createdAt));

  const active = input.activeOrganizationId ?? null;
  const membership =
    memberships.find((row) => row.organizationId === active) ??
    memberships[0];

  if (!membership) return null;

  if (membership.organizationId !== active) {
    await db
      .update(schema.session)
      .set({ activeOrganizationId: membership.organizationId })
      .where(eq(schema.session.id, input.sessionId));
  }

  return {
    organizationId: membership.organizationId,
    role: toMemberRole(membership.role),
  };
}
