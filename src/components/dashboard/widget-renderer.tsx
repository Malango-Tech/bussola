"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  ConnectPrompt,
  DemoNotice,
  StaleNotice,
  WidgetMessage,
} from "@/components/dashboard/widgets/widget-messages";
import {
  READ_THROUGH_WIDGETS,
  renderSnapshotWidget,
} from "@/components/dashboard/widgets/renderers";
import type { WidgetType } from "@/lib/widgets/registry";
import { getWidgetDefinition } from "@/lib/widgets/registry";
import { applyWidgetConfig, type WidgetConfig } from "@/lib/widgets/config";
import {
  isReadThroughType,
  readEnvelope,
  type SnapshotWidgetType,
} from "@/lib/widgets/snapshots";
import { useWidgetData } from "@/lib/widgets/widget-data-store";

/**
 * The frame around every widget's content.
 *
 * Everything that is the same for all widgets lives here — loading, errors,
 * "connect this source", demo and stale labels, a source the worker gave up
 * on. What a widget actually draws is looked up in the renderer registry
 * (`widgets/renderers`), one module per source, each typed against its
 * source's snapshot.
 */

type WidgetRendererProps = {
  type: WidgetType;
  /** Which connection feeds this widget. Absent means the provider's default. */
  connectionId?: string | null;
  config?: WidgetConfig;
};

const NO_CONFIG: WidgetConfig = {};

export function WidgetRenderer({
  type,
  connectionId,
  config = NO_CONFIG,
}: WidgetRendererProps) {
  if (isReadThroughType(type)) {
    const ReadThrough = READ_THROUGH_WIDGETS[type];
    return (
      <ReadThrough
        // Keyed on the connection so switching account starts a fresh widget
        // rather than appending a new account's pages onto the old cursor.
        key={connectionId ?? "default"}
        connectionId={connectionId}
        config={config}
      />
    );
  }
  return <LiveWidget type={type} connectionId={connectionId} config={config} />;
}

function LiveWidget({
  type,
  connectionId,
  config,
}: {
  type: SnapshotWidgetType;
  connectionId?: string | null;
  config: WidgetConfig;
}) {
  const { data, error, loading } = useWidgetData(type, connectionId);

  if (loading) {
    return (
      <div className="space-y-3 p-1" aria-busy="true">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
        <span className="sr-only">Loading widget</span>
      </div>
    );
  }

  if (error) {
    return (
      <WidgetMessage
        title={error}
        action={{ href: "/connections", label: "Check Connections" }}
      />
    );
  }

  if (!data) return null;

  const envelope = readEnvelope(data);

  if (envelope.needsConnection) {
    const def = getWidgetDefinition(type);
    const provider = String(envelope.provider || def?.provider || "source");
    return <ConnectPrompt provider={provider} />;
  }

  const sync = envelope._sync;

  // The worker gave up on this source — showing the last snapshot as if it
  // were current would hide a credential that needs replacing.
  if (sync?.disabled) {
    return (
      <WidgetMessage
        title={sync.lastError || "Syncing stopped for this source."}
        action={{ href: "/connections", label: "Reconnect" }}
      />
    );
  }

  // Scope, limit and range narrow the snapshot every widget of this source
  // shares, so this runs per widget rather than in the store.
  const view = applyWidgetConfig(type, config, data);

  return (
    <>
      {envelope._demo ? (
        <DemoNotice provider={envelope.provider ?? getWidgetDefinition(type)?.provider ?? ""} />
      ) : null}
      {sync?.stale ? <StaleNotice fetchedAt={sync.fetchedAt} /> : null}
      <div className="flex min-h-0 flex-1 flex-col">{renderSnapshotWidget(type, view)}</div>
    </>
  );
}
