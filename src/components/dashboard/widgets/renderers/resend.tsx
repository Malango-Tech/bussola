import { Badge } from "@/components/ui/badge";
import {
  ColumnChart,
  DonutChart,
  DualLineChart,
} from "@/components/dashboard/widgets/lazy-charts";
import { DataTable } from "@/components/dashboard/widgets/data-table";
import { StatusDot } from "@/components/dashboard/widgets/status-list";
import {
  NoData,
  WidgetMessage,
} from "@/components/dashboard/widgets/widget-messages";
import {
  formatRate,
  relativeAge,
  toneBadgeVariant,
} from "@/lib/widgets/widget-format";
import type { ServedSnapshot } from "@/lib/widgets/snapshots";
import type { RenderersFor } from "./types";

type Data = ServedSnapshot<"resend">;

/**
 * A Resend section that did not come back.
 *
 * Deliberately does not assert why. A restricted key is the common cause, but
 * the same flag is raised by an endpoint the account does not have and by an
 * upstream error, and telling someone with a full-access key that their key is
 * the problem sends them to fix something that is not broken. The server log
 * carries the actual status.
 */
function ResendUnavailable({ what }: { what: string }) {
  return (
    <WidgetMessage
      title={`Resend didn’t return ${what}. A restricted API key is the usual cause — check the connection if it persists.`}
      action={{ href: "/connections", label: "Check connection" }}
    />
  );
}

/** Every Resend chart reads the same metrics call, so they share an empty state. */
function ResendMetricsMissing({ missing }: { missing: boolean }) {
  if (missing) return <ResendUnavailable what="email metrics" />;
  return <NoData label="No email metrics for this period yet." />;
}

function renderDomains(data: Data) {
  const domains = data.domains || [];
  if (domains.length === 0) {
    return <NoData label="No sending domains configured." />;
  }
  return (
    <DataTable
      data={domains}
      rowKey={(domain) => domain.id}
      columns={[
        {
          header: "Domain",
          render: (domain) => (
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot status={domain.status} />
              <span className="truncate font-medium">{domain.name}</span>
            </div>
          ),
        },
        {
          header: "Status",
          render: (domain) => (
            <Badge variant={toneBadgeVariant(domain.status)}>
              {domain.rawStatus}
            </Badge>
          ),
        },
        {
          header: "Created",
          align: "right",
          render: (domain) => (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {relativeAge(domain.createdAt) ?? "—"}
            </span>
          ),
        },
      ]}
    />
  );
}

function renderEmails(data: Data) {
  if (data.emailsUnavailable) {
    return <ResendUnavailable what="sent emails" />;
  }
  const emails = data.emails || [];
  if (emails.length === 0) {
    return <NoData label="No emails sent yet." />;
  }
  return (
    <DataTable
      data={emails}
      rowKey={(email) => email.id}
      columns={[
        {
          header: "Email",
          render: (email) => (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{email.subject}</span>
              <span className="truncate text-xs text-muted-foreground">
                {email.to}
              </span>
            </div>
          ),
        },
        {
          header: "Status",
          render: (email) => (
            <Badge variant={toneBadgeVariant(email.tone)}>
              {email.status}
            </Badge>
          ),
        },
        {
          header: "Sent",
          align: "right",
          render: (email) => (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {relativeAge(email.sentAt) ?? "—"}
            </span>
          ),
        },
      ]}
    />
  );
}

function renderBroadcasts(data: Data) {
  if (data.broadcastsUnavailable) {
    return <ResendUnavailable what="broadcasts" />;
  }
  const broadcasts = data.broadcasts || [];
  if (broadcasts.length === 0) {
    return <NoData label="No broadcasts yet." />;
  }
  return (
    <DataTable
      data={broadcasts}
      rowKey={(broadcast) => broadcast.id}
      columns={[
        {
          header: "Broadcast",
          render: (broadcast) => (
            <span className="truncate font-medium">{broadcast.name}</span>
          ),
        },
        {
          header: "Status",
          render: (broadcast) => (
            <Badge variant={toneBadgeVariant(broadcast.tone)}>
              {broadcast.status}
            </Badge>
          ),
        },
        {
          header: "Updated",
          align: "right",
          render: (broadcast) => (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {relativeAge(broadcast.updatedAt) ?? "—"}
            </span>
          ),
        },
      ]}
    />
  );
}

function renderDelivery(data: Data) {
  const metrics = data.metrics;
  if (data.metricsUnavailable || !metrics) {
    return <ResendMetricsMissing missing={Boolean(data.metricsUnavailable)} />;
  }
  return (
    <DualLineChart
      countLabel="Emails"
      rateLabel="Deliverability"
      points={metrics.points.map((point) => ({
        label: point.label,
        count: point.sent,
        rate: point.deliveryRate,
        countDisplay: `${point.sent} sent · ${point.delivered} delivered`,
        rateDisplay: `${formatRate(point.deliveryRate)} delivered`,
      }))}
    />
  );
}

/** Open and click rates are one chart over two fields of the same points. */
function renderRate(which: "open" | "click", data: Data) {
  const metrics = data.metrics;
  if (data.metricsUnavailable || !metrics) {
    return <ResendMetricsMissing missing={Boolean(data.metricsUnavailable)} />;
  }
  const opens = which === "open";
  return (
    <ColumnChart
      domainMax={100}
      label={opens ? "Daily open rate" : "Daily click rate"}
      headline={{
        label: `Last ${metrics.days} days`,
        value: formatRate(
          opens ? metrics.totals.openRate : metrics.totals.clickRate,
        ),
      }}
      points={metrics.points.map((point) => ({
        label: point.label,
        value: opens ? point.openRate : point.clickRate,
        display: formatRate(opens ? point.openRate : point.clickRate),
        hint: `${point.delivered} delivered`,
      }))}
    />
  );
}

function renderOutcomes(data: Data) {
  const metrics = data.metrics;
  if (data.metricsUnavailable || !metrics) {
    return <ResendMetricsMissing missing={Boolean(data.metricsUnavailable)} />;
  }
  const total = metrics.outcomes.reduce(
    (sum, slice) => sum + slice.value,
    0,
  );
  if (total === 0) {
    return <NoData label="No emails sent in this period." />;
  }
  return (
    <DonutChart
      label="Email outcomes"
      items={metrics.outcomes.map((slice) => ({
        id: slice.id,
        name: slice.name,
        value: slice.value,
        display: `${slice.value} email${slice.value === 1 ? "" : "s"}`,
        sharePct: (slice.value / total) * 100,
      }))}
    />
  );
}

export const resendRenderers: RenderersFor<"resend"> = {
  "resend-domains": renderDomains,
  "resend-emails": renderEmails,
  "resend-broadcasts": renderBroadcasts,
  "resend-delivery": renderDelivery,
  "resend-open-rate": (data) => renderRate("open", data),
  "resend-click-rate": (data) => renderRate("click", data),
  "resend-outcomes": renderOutcomes,
};
