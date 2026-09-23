import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "..";
import { apiTokens, invitation, member, session, user } from "../schema";
import type { TenantContext } from "./context";

/**
 * Upper bound on the pending-invitation list.
 *
 * An invitation that expires unanswered stays `pending` — nothing moves it on
 * — so the list grows with every ignored invite. Members themselves are not
 * bounded here: seats are what the plan sells, and every seat must be listed
 * for an owner to be able to manage it.
 */
const MAX_INVITATIONS_LISTED = 100;

export function membersRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  return {
    /**
     * The people in this organization, with the account behind each seat.
     * Complete: bounded by the seats the plan sells (see the note above).
     */
    async list() {
      const db = await getDb();
      return db
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
          name: user.name,
          email: user.email,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, org))
        .orderBy(asc(member.createdAt));
    },

    /** Invitations still awaiting an answer, newest first. */
    async listPendingInvitations() {
      const db = await getDb();
      return db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, org),
            eq(invitation.status, "pending"),
          ),
        )
        .orderBy(desc(invitation.createdAt))
        .limit(MAX_INVITATIONS_LISTED);
    },

    /**
     * Remove someone from the organization.
     *
     * Refuses to remove the last owner: an organization with no owner has
     * nobody who can invite, bill or delete it, and there is no support desk
     * behind a self-hosted install to undo it.
     */
    async removeMember(memberId: string) {
      const db = await getDb();
      const [target] = await db
        .select({ id: member.id, role: member.role, userId: member.userId })
        .from(member)
        .where(and(eq(member.id, memberId), eq(member.organizationId, org)))
        .limit(1);
      if (!target) return { ok: false as const, reason: "not_found" as const };

      if (target.role === "owner") {
        // An admin may manage the team, not take it over from its owners.
        if (ctx.role !== "owner") {
          return { ok: false as const, reason: "forbidden" as const };
        }
        const [owners] = await db
          .select({ value: count() })
          .from(member)
          .where(
            and(eq(member.organizationId, org), eq(member.role, "owner")),
          );
        if ((owners?.value ?? 0) <= 1) {
          return { ok: false as const, reason: "last_owner" as const };
        }
      }

      /*
       * Removing the membership row is not enough on its own. The person's
       * sessions still name this organization, and API tokens they minted
       * act for it with no person behind them at all — so both go with
       * them, in the same transaction, or neither does.
       */
      await db.transaction(async (tx) => {
        await tx
          .delete(member)
          .where(and(eq(member.id, memberId), eq(member.organizationId, org)));
        await tx
          .delete(session)
          .where(
            and(
              eq(session.userId, target.userId),
              eq(session.activeOrganizationId, org),
            ),
          );
        await tx
          .update(apiTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(apiTokens.organizationId, org),
              eq(apiTokens.userId, target.userId),
              isNull(apiTokens.revokedAt),
            ),
          );
      });
      return { ok: true as const };
    },

    /** The caller's own role, for hiding controls they cannot use. */
    async roleOf(userId: string) {
      const db = await getDb();
      const [row] = await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, org), eq(member.userId, userId)))
        .limit(1);
      return row?.role ?? null;
    },

    /** Seats in use: members plus invitations still awaiting acceptance. */
    async countSeats() {
      const db = await getDb();
      const [members] = await db
        .select({ value: count() })
        .from(member)
        .where(eq(member.organizationId, org));
      const [pending] = await db
        .select({ value: count() })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, org),
            eq(invitation.status, "pending"),
          ),
        );
      return (members?.value ?? 0) + (pending?.value ?? 0);
    },
  };
}
