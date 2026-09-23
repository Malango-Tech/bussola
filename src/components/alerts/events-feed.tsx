import { formatDistanceToNow } from "date-fns";
import { BellRingingIcon } from "@phosphor-icons/react";
import { EmptyState, SectionHeading } from "@/components/layout/page";
import { SourceIcon } from "@/components/brand/source-icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EventRow } from "./types";

/** What has fired, newest first — the history no channel can lose. */
export function EventsFeed({ events }: { events: EventRow[] }) {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Recent"
        description="Every time a rule changed its mind, whether or not a channel took it."
      />
      {events.length === 0 ? (
        <EmptyState
          icon={<BellRingingIcon />}
          title="Nothing has fired"
          description="Alerts appear here the moment a rule's metric crosses its threshold."
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  event.state === "breached" ? "bg-destructive" : "bg-success",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate">{event.message}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <SourceIcon provider={event.provider} className="size-3" />
                  {event.connectionLabel} ·{" "}
                  {formatDistanceToNow(new Date(event.createdAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>
              {event.state === "breached" && !event.acknowledgedAt ? (
                <Badge variant="destructive">New</Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
