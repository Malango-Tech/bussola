import type { ReactNode } from "react";
import { LockSimpleIcon } from "@phosphor-icons/react/ssr";
import { ROLE_FOR, type Permission } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

/**
 * Why a control is missing or disabled, in the words the server would use.
 *
 * Shown in place of an action the person's role cannot take, so a member sees
 * who to ask rather than a gap in the screen — and the phrasing matches the
 * 403 that `withTenant` returns, so the hint and the refusal never disagree.
 * `children` finishes the sentence: "Only an owner or admin can …".
 */
export function PermissionHint({
  permission,
  id,
  className,
  children,
}: {
  permission: Permission;
  /** For `aria-describedby` on the control this explains. */
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      className={cn(
        "flex items-start gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <LockSimpleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Only {ROLE_FOR[permission] === "owner" ? "an owner" : "an owner or admin"}{" "}
        can {children}.
      </span>
    </p>
  );
}
