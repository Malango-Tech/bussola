import { z } from "zod";
import { jsonError, jsonOk, ROLE_FOR, withTenant } from "@/lib/api";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { emailConfigured, EMAIL_SETUP_HINT } from "@/lib/notify/email";

export const runtime = "nodejs";

/**
 * The people in an organization.
 *
 * Inviting and accepting run through Better Auth's own organization endpoints
 * — they own the invitation lifecycle and its expiry, and reimplementing that
 * here would mean two sources of truth for who is a member. This route covers
 * what Better Auth does not: seeing the roster with seat usage against the
 * plan, and removing someone.
 */
export async function GET() {
  return withTenant(async (repos) => {
    const [members, invitations, entitlements, seatsUsed] = await Promise.all([
      repos.members.list(),
      repos.members.listPendingInvitations(),
      entitlementsFor(repos.ctx.organizationId),
      repos.members.countSeats(),
    ]);

    const role = await repos.members.roleOf(repos.ctx.userId);

    return jsonOk({
      members: members.map((member) => ({
        id: member.id,
        userId: member.userId,
        name: member.name,
        email: member.email,
        role: member.role,
        joinedAt: member.createdAt,
        isYou: member.userId === repos.ctx.userId,
      })),
      invitations,
      seats: {
        used: seatsUsed,
        // Infinity does not survive JSON, so unlimited is sent as null.
        included: Number.isFinite(entitlements.limits.seats)
          ? entitlements.limits.seats
          : null,
      },
      planName: entitlements.planName,
      yourRole: role,
      // Inviting without a mail provider produces an invitation nobody is
      // told about, so the UI needs to know to offer the link instead.
      emailConfigured: emailConfigured(),
      emailSetupHint: EMAIL_SETUP_HINT,
    });
  });
}

const removeSchema = z.object({ memberId: z.string() });

export async function DELETE(request: Request) {
  return withTenant(async (repos) => {
    const { searchParams } = new URL(request.url);
    const parsed = removeSchema.safeParse({
      memberId: searchParams.get("memberId"),
    });
    if (!parsed.success) return jsonError("memberId required");

    const result = await repos.members.removeMember(parsed.data.memberId);
    if (result.ok) return jsonOk({ ok: true });

    switch (result.reason) {
      case "last_owner":
        return jsonError(
          "This is the only owner. Make someone else an owner first.",
          409,
        );
      case "forbidden":
        return jsonError("Only an owner can remove another owner.", 403);
      default:
        return jsonError("Member not found", 404);
    }
  }, { role: ROLE_FOR.manageMembers });
}
