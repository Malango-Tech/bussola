import type { MemberRole } from "@/lib/auth/roles";

/**
 * Who the current request is acting as. Produced only by `lib/auth/tenant.ts`
 * from a verified session — never from user input.
 *
 * Lives beside the repositories rather than in `tenant.ts` so each repository
 * module can take it without importing the file that composes them all.
 * `tenant.ts` re-exports it, and that remains the name callers use.
 */
export type TenantContext = {
  organizationId: string;
  userId: string;
  /**
   * The caller's role in the organization, for a person acting through a
   * session. Absent for callers that are not a member (a share link, an MCP
   * token, the worker), which therefore pass no role check.
   */
  role?: MemberRole;
};
