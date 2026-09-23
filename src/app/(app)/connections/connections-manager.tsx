"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, SectionHeading } from "@/components/layout/page";
import { SourceIcon } from "@/components/brand/source-icons";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ConnectionCard,
  type ConnectionView,
} from "@/components/connections/connection-card";
import { ConnectionDialog } from "@/components/connections/connection-dialog";
import { useConnectionActions } from "@/components/connections/use-connection-actions";
import { PROVIDER_CATALOG } from "@/lib/connectors/catalog";
import type { Provider } from "@/lib/providers";

export type { ConnectionView };

type Props = {
  connections: ConnectionView[];
  liveProviders: Provider[];
  comingSoon: Provider[];
  /** How many widgets currently read from each provider. */
  widgetCounts: Record<string, number>;
};

export function ConnectionsManager({
  connections,
  liveProviders,
  comingSoon,
  widgetCounts,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<{
    provider: Provider;
    connection?: ConnectionView;
  } | null>(null);
  const actions = useConnectionActions(widgetCounts);

  const byProvider = new Map(connections.map((c) => [c.provider, c]));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Connections"
        description="Tokens are encrypted before they are stored, and never reach the browser."
      />

      <section className="space-y-3">
        <SectionHeading
          title="Sources"
          description={`${connections.length} of ${liveProviders.length} connected`}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {liveProviders.map((provider) => {
            const connection = byProvider.get(provider);
            return (
              <ConnectionCard
                key={provider}
                provider={provider}
                connection={connection}
                widgetCount={widgetCounts[provider] ?? 0}
                busy={connection !== undefined && actions.busy === connection.id}
                onConnect={() => setEditing({ provider })}
                onEdit={(existing) =>
                  setEditing({ provider, connection: existing })
                }
                onRefresh={actions.refresh}
                onTest={actions.test}
                onRemove={actions.remove}
              />
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="Coming soon"
          description="Wave 2 needs an OAuth app for each provider."
        />
        <div className="flex flex-wrap gap-2">
          {comingSoon.map((provider) => {
            const entry = PROVIDER_CATALOG[provider];
            return (
              <Tooltip key={provider}>
                <TooltipTrigger
                  render={
                    <Badge variant="outline" className="gap-1.5">
                      <SourceIcon provider={provider} className="size-3" />
                      {entry.name}
                    </Badge>
                  }
                />
                <TooltipContent>
                  {entry.tagline}
                  {entry.soonNote ? ` · ${entry.soonNote}` : ""}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </section>

      {editing ? (
        <ConnectionDialog
          provider={editing.provider}
          connectionId={editing.connection?.id}
          currentLabel={editing.connection?.label}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
