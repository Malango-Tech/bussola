"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CopyIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react";
import { authClient } from "@/lib/auth/client";
import { can, hasRole, toMemberRole } from "@/lib/auth/roles";
import { readJson } from "@/components/api-client";
import { SectionHeading } from "@/components/layout/page";
import { PermissionHint } from "@/components/layout/permission-hint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
  isYou: boolean;
};

type Invitation = {
  id: string;
  email: string;
  role: string | null;
  expiresAt: string;
  createdAt: string;
};

type Payload = {
  members: Member[];
  invitations: Invitation[];
  seats: { used: number; included: number | null };
  planName: string;
  yourRole: string | null;
  emailConfigured: boolean;
  emailSetupHint: string;
};

const ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const;

/**
 * Who is in this organization, and how someone else gets in.
 *
 * Inviting goes through Better Auth, which owns the invitation lifecycle; this
 * only shows the roster and the seat count against the plan. The invite link
 * is surfaced after sending rather than only emailed, because a self-hosted
 * install with no mail provider would otherwise create invitations nobody is
 * ever told about.
 */
export function MembersSection() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [inviting, setInviting] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/members");
      if (!res.ok) return;
      setData((await res.json()) as Payload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setInviting(true);

    const { data: invitation, error } = await authClient.organization.inviteMember(
      { email: email.trim(), role: role as "member" | "admin" },
    );
    setInviting(false);

    if (error) {
      // Includes the seat guard's 402: "Your Solo plan includes 1 seat."
      toast.error(error.message || "Could not send the invitation");
      return;
    }

    setEmail("");
    if (invitation?.id) {
      setLastInviteLink(`${window.location.origin}/invite/${invitation.id}`);
    }
    toast.success(
      data?.emailConfigured
        ? "Invitation sent"
        : "Invitation created — copy the link below",
    );
    await load();
  }

  async function revoke(invitationId: string) {
    const { error } = await authClient.organization.cancelInvitation({
      invitationId,
    });
    if (error) {
      toast.error(error.message || "Could not revoke the invitation");
      return;
    }
    toast.success("Invitation revoked");
    await load();
  }

  async function remove(memberId: string) {
    const res = await fetch(`/api/members?memberId=${memberId}`, {
      method: "DELETE",
    });
    const json = await readJson(res);
    if (!res.ok) {
      toast.error(json.error || "Could not remove this member");
      return;
    }
    toast.success("Member removed");
    await load();
  }

  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading members">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Could not load members. Try reopening settings.
      </p>
    );
  }

  const seatsLeft =
    data.seats.included === null
      ? null
      : Math.max(0, data.seats.included - data.seats.used);
  // The same table the server enforces with, so a role added to ROLE_FOR
  // later cannot leave this screen offering what the API will refuse.
  const yourRole = toMemberRole(data.yourRole);
  const canManage = can(yourRole, "manageMembers");
  /** Admins manage the team; only an owner may remove another owner. */
  const canRemove = (member: Member) =>
    canManage &&
    !member.isYou &&
    (toMemberRole(member.role) !== "owner" || hasRole(yourRole, "owner"));
  const seatsFull = seatsLeft !== null && seatsLeft <= 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeading
          title="Members"
          description={
            data.seats.included === null
              ? `${data.seats.used} in this organization · unlimited seats`
              : `${data.seats.used} of ${data.seats.included} seats used on ${data.planName}`
          }
        />
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data.members.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-3 px-3 py-2.5 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {member.name || member.email}
                  {member.isYou ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      you
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email} · joined{" "}
                  {format(new Date(member.joinedAt), "d MMM yyyy")}
                </p>
              </div>
              <Badge variant="outline">{member.role}</Badge>
              {canRemove(member) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${member.email}`}
                  onClick={() => remove(member.id)}
                >
                  <TrashIcon className="size-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {!canManage ? (
          <PermissionHint permission="manageMembers">
            invite or remove people
          </PermissionHint>
        ) : null}
      </section>

      {data.invitations.length > 0 ? (
        <section className="space-y-3 border-t border-border pt-6">
          <SectionHeading
            title="Pending invitations"
            description="These hold a seat until they are accepted or revoked."
          />
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center gap-3 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate">{invitation.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires {format(new Date(invitation.expiresAt), "d MMM yyyy")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Copy invitation link for ${invitation.email}`}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(
                        `${window.location.origin}/invite/${invitation.id}`,
                      )
                      .then(() => toast.success("Link copied"))
                      .catch(() => toast.error("Could not copy"));
                  }}
                >
                  <CopyIcon className="size-4" aria-hidden />
                </Button>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Revoke invitation for ${invitation.email}`}
                    onClick={() => revoke(invitation.id)}
                  >
                    <TrashIcon className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canManage ? (
        <section className="space-y-3 border-t border-border pt-6">
          <SectionHeading
            title="Invite someone"
            description={
              seatsFull
                ? `Every seat on ${data.planName} is in use. Add a seat to invite more people.`
                : "They get a link, and join once they accept it."
            }
          />

          {!data.emailConfigured ? (
            <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <WarningIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                No mail provider is configured, so invitations are not emailed —
                copy the link and send it yourself. {data.emailSetupHint}
              </span>
            </p>
          ) : null}

          <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                placeholder="teammate@yourcompany.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="w-32 space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                id="invite-role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                {ROLES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={inviting || seatsFull}>
              {inviting ? "Sending…" : "Invite"}
            </Button>
          </form>

          {lastInviteLink ? (
            <div className="flex items-center gap-2">
              <Input
                readOnly
                aria-label="Invitation link"
                value={lastInviteLink}
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy invitation link"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(lastInviteLink)
                    .then(() => toast.success("Link copied"))
                    .catch(() => toast.error("Could not copy"));
                }}
              >
                <CopyIcon className="size-4" aria-hidden />
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
