"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { SparkleIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { getSourceMeta } from "@/components/brand/source-icons";

/** One shared treatment for every "this widget can't show data right now"
 *  state — connect prompts, load errors, and empty results. */
export function WidgetMessage({
  title,
  action,
}: {
  title: string;
  action?: { href: string; label: string };
}) {
  return (
    <div
      data-slot="widget-message"
      className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center"
    >
      <p className="text-sm text-muted-foreground text-balance">{title}</p>
      {action ? (
        <Link
          href={action.href}
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function ConnectPrompt({ provider }: { provider: string }) {
  const label =
    provider === "multi" ? "a source" : getSourceMeta(provider).title;
  return (
    <WidgetMessage
      title={`Connect ${label} to see this widget.`}
      action={{ href: "/connections", label: "Open Connections" }}
    />
  );
}

export function NoData({ label }: { label: string }) {
  return <WidgetMessage title={label} />;
}

/**
 * Shown above a widget rendering sample data.
 *
 * Demo data exists so a new account looks alive rather than broken, which only
 * works if nobody can mistake it for their own numbers — so this is a label,
 * not a hint, and it carries the action that makes it go away.
 */
export function DemoNotice({ provider }: { provider?: string }) {
  const label =
    provider && provider !== "multi"
      ? getSourceMeta(provider).title
      : "a source";

  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant="secondary" className="gap-1">
        <SparkleIcon className="size-3" />
        Demo data
      </Badge>
      <Link
        href="/connections"
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Connect {label} to see yours
      </Link>
    </div>
  );
}

/**
 * Shown above a widget whose snapshot has fallen well behind its sync
 * schedule. The numbers are still real, just old — saying so beats silently
 * presenting stale data as current.
 */
export function StaleNotice({ fetchedAt }: { fetchedAt?: string | null }) {
  const when = fetchedAt ? new Date(fetchedAt) : null;
  const label =
    when && !Number.isNaN(when.getTime())
      ? `Last updated ${formatDistanceToNow(when, { addSuffix: true })}`
      : "This data may be out of date";

  return (
    <p className="mb-2 shrink-0 text-xs text-muted-foreground">{label}</p>
  );
}
