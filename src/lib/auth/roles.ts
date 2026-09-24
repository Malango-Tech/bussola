/**
 * Roles and what they may do. Pure, so the server enforces and the browser
 * hides controls from the same table.
 */

/** Ordered from least to most privileged. */
export const MEMBER_ROLES = ["member", "admin", "owner"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * A stored role, normalised.
 *
 * Better Auth stores roles as free text and can hold a comma-separated list;
 * the most privileged recognised one wins, and anything unrecognised is the
 * least privileged rather than an error.
 */
export function toMemberRole(raw: string | null | undefined): MemberRole {
  const roles = (raw ?? "").split(",").map((role) => role.trim());
  for (const role of [...MEMBER_ROLES].reverse()) {
    if (roles.includes(role)) return role;
  }
  return "member";
}

/** Whether `role` carries at least the privileges of `minimum`. */
export function hasRole(
  role: MemberRole | null | undefined,
  minimum: MemberRole,
): boolean {
  if (!role) return false;
  return MEMBER_ROLES.indexOf(role) >= MEMBER_ROLES.indexOf(minimum);
}

/**
 * Who may do what.
 *
 * Members read and build: dashboards, widgets, alert rules. Admins manage what
 * reaches outside the organization or holds its secrets — connections and
 * their credentials, share links, alert channels, API tokens, members. Only
 * an owner can change what the organization pays for. A self-hosted install
 * has one account, which is its owner, so none of this ever gets in its way.
 */
export const ROLE_FOR = {
  manageConnections: "admin",
  manageShares: "admin",
  manageChannels: "admin",
  manageTokens: "admin",
  manageMembers: "admin",
  manageBilling: "owner",
} as const satisfies Record<string, MemberRole>;

export type Permission = keyof typeof ROLE_FOR;

export function can(
  role: MemberRole | null | undefined,
  permission: Permission,
): boolean {
  return hasRole(role, ROLE_FOR[permission]);
}
