import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/widgets/stat-card";
import {
  ActivityPanel,
  type ActivityPanelEvent,
} from "@/components/dashboard/widgets/activity-panel";
import { BarChart } from "@/components/dashboard/widgets/bar-chart";
import { LineChart } from "@/components/dashboard/widgets/lazy-charts";
import { DataTable } from "@/components/dashboard/widgets/data-table";
import {
  StatusDot,
  StatusList,
  statusLabel,
} from "@/components/dashboard/widgets/status-list";
import {
  NoData,
  WidgetMessage,
} from "@/components/dashboard/widgets/widget-messages";
import {
  deployBadgeVariant,
  formatCores,
  formatGb,
  shortAge,
  shortId,
  toneBadgeVariant,
} from "@/lib/widgets/widget-format";
import { formatMoney } from "@/lib/format/money";
import type {
  RailwayDeployAttempt,
  RailwayMetricSeries,
} from "@/lib/connectors/types";
import type { ServedSnapshot } from "@/lib/widgets/snapshots";
import type { RenderersFor } from "./types";

type Data = ServedSnapshot<"railway">;

/** Maps a Railway deploy attempt's raw status to a short human label. */
function attemptStatusLabel(attempt: RailwayDeployAttempt): string {
  const raw = attempt.rawStatus.toUpperCase();
  if (raw === "FAILED") return "Deploy failed";
  if (raw === "CRASHED") return "Crashed";
  if (raw === "BUILDING") return "Building";
  if (raw === "DEPLOYING") return "Deploying";
  if (raw === "QUEUED") return "Queued";
  if (raw === "WAITING") return "Waiting";
  if (raw === "INITIALIZING") return "Starting";
  return attempt.stage;
}

function eventFromAttempt(
  attempt: RailwayDeployAttempt,
  tone: "destructive" | "warning",
): ActivityPanelEvent {
  return {
    id: attempt.id,
    age: shortAge(attempt.createdAt),
    label: attemptStatusLabel(attempt),
    tone,
    meta: shortId(attempt.id),
  };
}

function renderTracker(data: Data) {
  const health = data.deployHealth;
  if (!health) {
    return <NoData label="No services found for this connection." />;
  }
  const behind = health.behindCount;
  const liveAge = shortAge(health.active.createdAt);
  const events: ActivityPanelEvent[] = [
    ...(health.inFlight ? [eventFromAttempt(health.inFlight, "warning" as const)] : []),
    ...health.failedSinceActive
      .slice(0, 3)
      .map((attempt) => eventFromAttempt(attempt, "destructive" as const)),
  ];
  return (
    <ActivityPanel
      title={health.serviceName}
      subtitle={health.projectName}
      status={{
        label:
          health.active.status === "healthy"
            ? "Healthy"
            : health.active.status === "crashed"
              ? "Crashed"
              : health.active.status === "sleeping"
                ? "Sleeping"
                : "Unknown",
        tone:
          health.active.status === "healthy"
            ? "positive"
            : health.active.status === "crashed"
              ? "negative"
              : "neutral",
      }}
      headline={
        behind > 0
          ? `${behind} behind`
          : health.active.status === "crashed"
            ? "Crashed"
            : health.inFlight
              ? "Shipping"
              : "Up to date"
      }
      headlineTone={
        behind > 0 || health.active.status === "crashed"
          ? "negative"
          : "neutral"
      }
      meta={[
        liveAge ? `live ${liveAge}` : null,
        health.active.commitHash,
        behind === 0 ? health.active.label : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      events={events}
      moreCount={Math.max(behind - health.failedSinceActive.slice(0, 3).length, 0)}
    />
  );
}

function renderFleet(data: Data) {
  const fleet = data.fleet;
  if (!fleet || fleet.total === 0) {
    return <NoData label="No Railway services found." />;
  }
  const allHealthy = fleet.healthy === fleet.total;
  const issues = fleet.crashed + fleet.degraded;
  return (
    <StatCard
      label="Healthy services"
      value={`${fleet.healthy}/${fleet.total}`}
      hint={
        issues > 0
          ? `${issues} need attention`
          : fleet.sleeping > 0
            ? `${fleet.sleeping} sleeping`
            : "All services checked"
      }
      trend={allHealthy ? "All healthy" : undefined}
      trendTone={allHealthy ? "positive" : "neutral"}
    />
  );
}

function renderResources(data: Data) {
  const resources = data.resources;
  if (
    !resources ||
    (resources.cpuCores == null && resources.memoryGb == null)
  ) {
    return (
      <NoData label="No CPU/memory metrics yet (needs a running deploy)." />
    );
  }
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <BarChart
        rows={[
          {
            label: "CPU",
            value: resources.cpuCores ?? 0,
            display:
              resources.cpuCores == null
                ? "—"
                : formatCores(resources.cpuCores),
            tone: "neutral",
          },
          {
            label: "Memory",
            value: resources.memoryGb ?? 0,
            display:
              resources.memoryGb == null
                ? "—"
                : formatGb(resources.memoryGb),
            tone: "out",
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">{resources.label}</p>
    </div>
  );
}

function renderUsage(data: Data) {
  const usage = data.usage || [];
  if (usage.length === 0) {
    return (
      <NoData label="No usage estimate available for this token/plan." />
    );
  }
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <BarChart
        rows={usage.map((row) => ({
          label: row.label,
          value: row.value,
          display: row.display,
          tone: "neutral" as const,
        }))}
      />
      <p className="text-xs text-muted-foreground">Current billing cycle</p>
    </div>
  );
}

function renderDeploys(data: Data) {
  const deploys = data.recentDeploys || [];
  if (deploys.length === 0) {
    return <NoData label="No recent deployments." />;
  }
  return (
    <DataTable
      data={deploys}
      rowKey={(deploy) => deploy.id}
      columns={[
        {
          header: "Service",
          render: (deploy) => (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">
                {deploy.serviceName}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {deploy.projectName}
              </span>
            </div>
          ),
        },
        {
          header: "Status",
          render: (deploy) => (
            <Badge variant={deployBadgeVariant(deploy.status)}>
              {deploy.rawStatus.toLowerCase()}
            </Badge>
          ),
        },
        {
          header: "When",
          align: "right",
          className: "whitespace-nowrap text-muted-foreground",
          render: (deploy) => format(new Date(deploy.createdAt), "MMM d · HH:mm"),
        },
      ]}
    />
  );
}

function renderProjects(data: Data) {
  const projects = data.projects || [];
  if (projects.length === 0) {
    return <NoData label="No Railway projects found." />;
  }
  return (
    <DataTable
      data={projects}
      rowKey={(project) => project.id}
      columns={[
        {
          header: "Project",
          render: (project) => (
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot status={project.status} />
              <span className="truncate font-medium">{project.name}</span>
            </div>
          ),
        },
        {
          header: "Services",
          render: (project) => (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {project.detail}
            </span>
          ),
        },
        {
          header: "Status",
          align: "right",
          render: (project) => (
            <Badge variant={toneBadgeVariant(project.status)}>
              {statusLabel(project.status)}
            </Badge>
          ),
        },
      ]}
    />
  );
}

function renderBilling(data: Data) {
  const billing = data.billing;
  if (!billing) {
    return (
      <WidgetMessage title="Railway didn’t return billing. It is workspace-scoped, so a project token cannot read it." />
    );
  }
  const currency = billing.currency.toUpperCase();
  const cycle =
    billing.cycleStart && billing.cycleEnd
      ? `${format(new Date(billing.cycleStart), "d MMM")} – ${format(new Date(billing.cycleEnd), "d MMM")}`
      : undefined;
  return (
    <StatCard
      label="Estimated bill"
      value={
        billing.estimatedBill !== null
          ? formatMoney(billing.estimatedBill, currency)
          : "—"
      }
      hint={
        billing.currentUsage !== null
          ? `${formatMoney(billing.currentUsage, currency)} used so far`
          : billing.workspaceName
      }
      trend={cycle}
      trendTone="neutral"
    />
  );
}

/* ─────────────────────────────── usage series ─────────────────────────── */

type SeriesSpec = { key: RailwayMetricSeries["key"]; empty: string };

const CPU: SeriesSpec = { key: "cpu", empty: "No CPU metrics reported." };
const MEMORY: SeriesSpec = { key: "memory", empty: "No memory metrics reported." };
const EGRESS: SeriesSpec = { key: "egress", empty: "No egress metrics reported." };
const DISK: SeriesSpec = {
  key: "disk",
  // Disk is volume-backed, so a project with no volume reports a real zero.
  empty: "No disk metrics — this project has no volumes attached.",
};

function formatRailwayValue(value: number, unit: string): string {
  if (unit === "GB" && value > 0 && value < 0.1) {
    return `${(value * 1024).toFixed(value * 1024 < 10 ? 2 : 1)} MB`;
  }
  if (unit === "vCPU") return `${value.toFixed(value >= 1 ? 2 : 3)} vCPU`;
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

/** One usage chart: the series' latest value over its trail. */
function renderSeries(spec: SeriesSpec, data: Data) {
  const metrics = data.metrics;
  const series = metrics?.series.find((s) => s.key === spec.key);

  if (!metrics || !series || series.points.length === 0) {
    return <NoData label={spec.empty} />;
  }

  const scope = metrics.environmentName
    ? `${metrics.projectName} · ${metrics.environmentName}`
    : metrics.projectName;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">{scope}</p>
        <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
          peak {formatRailwayValue(series.peak, series.unit)}
        </p>
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
        {series.latest !== null
          ? formatRailwayValue(series.latest, series.unit)
          : "—"}
      </p>
      <div className="min-h-0 flex-1">
        <LineChart
          label={`${series.label}, ${scope}`}
          points={series.points.map((point) => ({
            label: point.label,
            value: point.value,
            display: formatRailwayValue(point.value, series.unit),
          }))}
        />
      </div>
    </div>
  );
}

export const railwayRenderers: RenderersFor<"railway"> = {
  "railway-tracker": renderTracker,
  "railway-services": (data) => {
    const items = data.items || [];
    if (items.length === 0) {
      return <NoData label="No Railway services found." />;
    }
    return <StatusList items={items} />;
  },
  "railway-fleet": renderFleet,
  "railway-resources": renderResources,
  "railway-usage": renderUsage,
  "railway-deploys": renderDeploys,
  "railway-projects": renderProjects,
  "railway-billing": renderBilling,
  "railway-cpu": (data) => renderSeries(CPU, data),
  "railway-memory": (data) => renderSeries(MEMORY, data),
  "railway-egress": (data) => renderSeries(EGRESS, data),
  "railway-disk": (data) => renderSeries(DISK, data),
};
