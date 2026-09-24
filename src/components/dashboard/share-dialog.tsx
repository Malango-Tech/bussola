"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  CopyIcon,
  LinkIcon,
  ProhibitIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useCan } from "@/components/providers/role-provider";

type ShareRow = {
  id: string;
  tokenPrefix: string;
  label: string | null;
  whiteLabel: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
};

type Props = {
  dashboardId: string;
  dashboardName: string;
  canShare: boolean;
  onClose: () => void;
};

const EXPIRY_CHOICES = [
  { value: "0", label: "Until I revoke it" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;

/**
 * Read-only links to one dashboard.
 *
 * The token is shown once, immediately after minting, and never again — only
 * its hash is stored, so there is nothing to show later. The UI has to make
 * that obvious rather than leaving someone to discover it, which is why a
 * fresh link gets its own panel with a copy button instead of appearing as
 * another row in the list.
 *
 * Anyone in the organization may see which links are live; creating and
 * revoking them is an admin's call (`manageShares`). The server refuses both
 * for a member regardless, so hiding the controls only spares them a form that
 * was always going to fail — and says why, rather than leaving a gap.
 */
export function ShareDialog({
  dashboardId,
  dashboardName,
  canShare,
  onClose,
}: Props) {
  const canManage = useCan("manageShares");
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [canWhiteLabel, setCanWhiteLabel] = useState(false);
  const [planName, setPlanName] = useState("");

  const [label, setLabel] = useState("");
  const [whiteLabel, setWhiteLabel] = useState(false);
  const [expiry, setExpiry] = useState<string>("0");

  /** The one and only time a token is visible. */
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/shares`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        shares: ShareRow[];
        canWhiteLabel: boolean;
        planName: string;
      };
      setShares(json.shares);
      setCanWhiteLabel(json.canWhiteLabel);
      setPlanName(json.planName);
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setCreating(true);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || undefined,
          whiteLabel,
          expiresInDays: expiry === "0" ? undefined : Number(expiry),
        }),
      });
      const json = (await res.json()) as {
        token?: string;
        downgraded?: boolean;
        error?: string;
      };
      if (!res.ok || !json.token) {
        toast.error(json.error || "Could not create the link");
        return;
      }
      setFreshToken(json.token);
      setLabel("");
      if (json.downgraded) {
        toast("Link created with Bussola branding — white-label needs Team.");
      }
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(shareId: string) {
    const res = await fetch(
      `/api/dashboards/${dashboardId}/shares?shareId=${shareId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      toast.error("Could not revoke the link");
      return;
    }
    toast.success("Link revoked");
    await load();
  }

  const active = shares.filter((share) => !share.revokedAt);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share “{dashboardName}”</DialogTitle>
          <DialogDescription>
            Anyone with the link sees this dashboard, read-only. No account, no
            editing, and only the widgets on this canvas.
          </DialogDescription>
        </DialogHeader>

        {!canShare ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
            <WarningIcon
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                Read-only links are not part of the {planName || "current"} plan.
              </p>
              <p className="text-muted-foreground">
                Upgrade to Team to send a client or a co-founder a live view
                instead of a screenshot.
              </p>
            </div>
          </div>
        ) : null}

        {freshToken ? (
          <div className="space-y-2 rounded-lg border border-success/40 bg-success/5 p-3">
            <p className="text-sm font-medium">
              Copy this link now — it is not shown again.
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                aria-label="New share link"
                value={shareUrl(freshToken)}
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy link"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(shareUrl(freshToken))
                    .then(() => toast.success("Link copied"))
                    .catch(() => toast.error("Could not copy — select and copy manually"));
                }}
              >
                <CopyIcon className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only a hash of it is stored, so a lost link has to be revoked and
              replaced rather than looked up.
            </p>
          </div>
        ) : null}

        {canShare && !canManage ? (
          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            Only admins can create or revoke links. Ask one if this dashboard
            needs a new link, or an old one taken down.
          </p>
        ) : null}

        {canShare && canManage ? (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="share-label">Label (optional)</Label>
              <Input
                id="share-label"
                value={label}
                placeholder="e.g. Investor update"
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="share-expiry">Expires</Label>
              <Select
                id="share-expiry"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
              >
                {EXPIRY_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </div>

            <label
              className="flex items-center justify-between gap-3 text-sm"
              htmlFor="share-white-label"
            >
              <span>
                <span className="font-medium">White-label</span>
                <span className="block text-xs text-muted-foreground">
                  {canWhiteLabel
                    ? "Hide Bussola branding on the shared page."
                    : "Team plan and self-hosted only."}
                </span>
              </span>
              <Switch
                id="share-white-label"
                checked={whiteLabel}
                disabled={!canWhiteLabel}
                onCheckedChange={setWhiteLabel}
              />
            </label>

            <Button
              type="button"
              className="w-full"
              onClick={create}
              disabled={creating}
            >
              <LinkIcon className="size-4" />
              {creating ? "Creating…" : "Create link"}
            </Button>
          </div>
        ) : null}

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm font-medium">
            Active links {active.length ? `(${active.length})` : ""}
          </p>
          {loading ? (
            <Skeleton className="h-10 w-full" />
          ) : active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No live links for this dashboard.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {active.map((share) => (
                <li
                  key={share.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {share.label || (
                        <span className="font-mono text-xs">
                          {share.tokenPrefix}…
                        </span>
                      )}
                      {share.whiteLabel ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          white-label
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {share.viewCount} view{share.viewCount === 1 ? "" : "s"}
                      {share.expiresAt
                        ? ` · expires ${format(new Date(share.expiresAt), "d MMM yyyy")}`
                        : " · no expiry"}
                    </p>
                  </div>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Revoke link ${share.label || `${share.tokenPrefix}…`}`}
                      onClick={() => revoke(share.id)}
                    >
                      <ProhibitIcon className="size-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Absolute, so what is copied works wherever it is pasted. */
function shareUrl(token: string): string {
  const origin =
    typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/share/${token}`;
}
