"use client";

import { createContext, useContext, type ReactNode } from "react";
import { can, type MemberRole, type Permission } from "@/lib/auth/roles";

/**
 * The signed-in person's role, for hiding controls they cannot use.
 *
 * Purely cosmetic: every one of these actions is refused server-side by
 * `withTenant(..., { role })` whatever the browser shows. Hiding them just
 * saves a member from filling in a form that was always going to be refused.
 */
const RoleContext = createContext<MemberRole | null>(null);

export function RoleProvider({
  role,
  children,
}: {
  role: MemberRole;
  children: ReactNode;
}) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): MemberRole | null {
  return useContext(RoleContext);
}

/**
 * Whether the current person may do something.
 *
 * Outside a provider (a share page, a test) this answers true and leaves the
 * decision to the server, rather than hiding controls nobody meant to hide.
 */
export function useCan(permission: Permission): boolean {
  const role = useContext(RoleContext);
  return role === null ? true : can(role, permission);
}
