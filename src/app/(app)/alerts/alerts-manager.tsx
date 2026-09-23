"use client";

import { useMemo } from "react";
import { CheckIcon, WarningIcon } from "@phosphor-icons/react";
import { ChannelsSection } from "@/components/alerts/channels-section";
import { EventsFeed } from "@/components/alerts/events-feed";
import { RulesSection } from "@/components/alerts/rules-section";
import { useAlerts } from "@/components/alerts/use-alerts";
import type {
  ChannelKind,
  ChannelRow,
  EventRow,
  MetricOption,
  RuleRow,
} from "@/components/alerts/types";
import { PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import type { Provider } from "@/lib/providers";

type Props = {
  initialRules: RuleRow[];
  initialChannels: ChannelRow[];
  initialEvents: EventRow[];
  connections: Array<{ id: string; provider: Provider; label: string }>;
  metrics: MetricOption[];
  allowedChannels: ChannelKind[];
  planName: string;
  emailReady: boolean;
  emailSetupHint: string;
};

/**
 * Rules, channels and what has fired.
 *
 * One screen rather than three, because the three are useless apart: a rule
 * with no channel notifies nobody, and a channel with no rule never fires.
 * Seeing all of it at once is what makes it obvious which half is missing.
 *
 * This component only lays the sections out; the data and every request that
 * changes it live in `useAlerts`, and each section owns its own form.
 */
export function AlertsManager({
  initialRules,
  initialChannels,
  initialEvents,
  connections,
  metrics,
  allowedChannels,
  planName,
  emailReady,
  emailSetupHint,
}: Props) {
  const alerts = useAlerts({
    rules: initialRules,
    channels: initialChannels,
    events: initialEvents,
  });

  const alertsAvailable = allowedChannels.length > 0;
  const unacknowledged = alerts.events.filter(
    (event) => event.state === "breached" && !event.acknowledgedAt,
  ).length;

  /** Connections that have at least one metric worth watching. */
  const alertable = useMemo(() => {
    const withMetrics = new Set(metrics.map((metric) => metric.provider));
    return connections.filter((connection) =>
      withMetrics.has(connection.provider),
    );
  }, [connections, metrics]);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Alerts"
        description="Get told when a number crosses a line, instead of finding out next time you look."
        actions={
          unacknowledged > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={alerts.acknowledgeAll}
            >
              <CheckIcon className="size-4" aria-hidden />
              Acknowledge {unacknowledged}
            </Button>
          ) : null
        }
      />

      {!alertsAvailable ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-4">
          <WarningIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="space-y-1 text-sm">
            <p className="font-medium">
              Alerts are not part of the {planName} plan.
            </p>
            <p className="text-muted-foreground">
              Solo adds email alerts; Team adds Slack and Discord. Self-hosted
              has all three.
            </p>
          </div>
        </div>
      ) : null}

      <EventsFeed events={alerts.events} />

      <RulesSection
        rules={alerts.rules}
        alertable={alertable}
        metrics={metrics}
        channels={alerts.channels}
        onCreate={alerts.createRule}
        onPatch={alerts.patchRule}
        onDelete={alerts.deleteRule}
      />

      <ChannelsSection
        channels={alerts.channels}
        allowedChannels={allowedChannels}
        emailReady={emailReady}
        emailSetupHint={emailSetupHint}
        testing={alerts.testing}
        onCreate={alerts.createChannel}
        onDelete={alerts.deleteChannel}
        onTest={alerts.sendTest}
      />
    </div>
  );
}
