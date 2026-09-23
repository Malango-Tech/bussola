"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  PencilSimpleIcon,
  PlugsIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { SourceIcon } from "@/components/brand/source-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PROVIDER_CATALOG } from "@/lib/connectors/catalog";
import { connectionHealth } from "@/lib/connectors/health";
import type { Provider } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { plural } from "./use-connection-actions";

export type ConnectionView = {
  id: string;
  provider: Provider;
  label: string;
  status: string;
  lastError: string | null;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
  consecutiveFailures: number;
};

type Props = {
  provider: Provider;
  /** Absent until the source is connected. */
  connection: ConnectionView | undefined;
  /** How many widgets read from this provider. */
  widgetCount: number;
  /** A request for this card's connection is in flight. */
  busy: boolean;
  /**
   * Whether this person may add, replace or remove connections. Refresh and
   * test stay available to everyone: they change nothing but the snapshot.
   */
  canManage: boolean;
  /** The hint explaining why Connect is disabled, when it is. */
  permissionHintId?: string;
  onConnect: () => void;
  onEdit: (connection: ConnectionView) => void;
  onRefresh: (connection: ConnectionView) => void;
  onTest: (connection: ConnectionView) => void;
  onRemove: (connection: ConnectionView) => void;
};

/** One source: its health and what can be done with it. */
export function ConnectionCard({
  provider,
  connection,
  widgetCount,
  busy,
  canManage,
  permissionHintId,
  onConnect,
  onEdit,
  onRefresh,
  onTest,
  onRemove,
}: Props) {
  const entry = PROVIDER_CATALOG[provider];
  const state = connection ? connectionHealth(connection) : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4",
        state?.tone === "error" && "border-destructive/40",
      )}
    >
      <div className="flex items-start gap-3">
        <SourceIcon provider={provider} className="mt-0.5 size-5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{entry.name}</p>
            {state ? (
              <Badge
                variant={
                  state.tone === "ok"
                    ? "secondary"
                    : state.tone === "warn"
                      ? "outline"
                      : "destructive"
                }
              >
                {state.label}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground text-balance">
            {entry.tagline}
          </p>
        </div>
      </div>

      {connection ? (
        <>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>
              <dt className="sr-only">Last synced</dt>
              <dd>
                {connection.lastSyncedAt
                  ? `Synced ${formatDistanceToNow(
                      new Date(connection.lastSyncedAt),
                      { addSuffix: true },
                    )}`
                  : "Not synced yet"}
              </dd>
            </div>
            {widgetCount ? (
              <div>
                <dt className="sr-only">Widgets</dt>
                <dd>{plural(widgetCount, "widget")}</dd>
              </div>
            ) : null}
          </dl>

          {connection.lastError ? (
            <p
              className={cn(
                "text-xs text-balance",
                connection.syncEnabled
                  ? "text-muted-foreground"
                  : "text-destructive",
              )}
            >
              {connection.lastError}
              {!connection.syncEnabled
                ? " Syncing stopped after repeated failures — save new credentials to resume."
                : null}
            </p>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => onRefresh(connection)}
            >
              <ArrowClockwiseIcon className="size-3" />
              Refresh
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => onTest(connection)}
            >
              Test
            </Button>
            {canManage ? (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Edit ${entry.name} connection`}
                        onClick={() => onEdit(connection)}
                      >
                        <PencilSimpleIcon className="size-3" />
                      </Button>
                    }
                  />
                  <TooltipContent>Replace credentials</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${entry.name} connection`}
                        disabled={busy}
                        onClick={() => onRemove(connection)}
                      >
                        <TrashIcon className="size-3" />
                      </Button>
                    }
                  />
                  <TooltipContent>Remove</TooltipContent>
                </Tooltip>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-auto flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="xs"
            disabled={!canManage}
            aria-describedby={canManage ? undefined : permissionHintId}
            onClick={onConnect}
          >
            <PlugsIcon className="size-3" />
            Connect
          </Button>
          {entry.docsUrl ? (
            <a
              href={entry.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Get a token
              <ArrowSquareOutIcon className="size-3" />
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}
