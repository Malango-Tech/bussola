import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/widgets/stat-card";
import { BarChart } from "@/components/dashboard/widgets/bar-chart";
import { DataTable } from "@/components/dashboard/widgets/data-table";
import {
  StatusList,
  type StatusRow,
} from "@/components/dashboard/widgets/status-list";
import { NoData } from "@/components/dashboard/widgets/widget-messages";
import { toneBadgeVariant } from "@/lib/widgets/widget-format";
import type { ServedSnapshot } from "@/lib/widgets/snapshots";
import type { RenderersFor } from "./types";

type Data = ServedSnapshot<"supabase">;

function renderHealth(data: Data) {
  const healthy = data.healthy || 0;
  const total = data.total || 0;
  if (total === 0) {
    return <NoData label="No Supabase projects found." />;
  }
  return (
    <StatCard
      label="Healthy projects"
      value={`${healthy}/${total}`}
      hint={total === 1 ? "1 project" : `${total} projects`}
      trend={healthy === total ? "All healthy" : undefined}
      trendTone={healthy === total ? "positive" : "neutral"}
    />
  );
}

function renderServices(data: Data) {
  const services = data.services || [];
  if (services.length === 0) {
    return (
      <NoData label="No service health data yet (check PAT permissions)." />
    );
  }
  const items: StatusRow[] = services.map((service) => ({
    id: service.id,
    name: `${service.projectName} / ${service.serviceName}`,
    status: service.status,
    detail: service.detail,
  }));
  return <StatusList items={items} />;
}

function renderTraffic(data: Data) {
  const traffic = data.traffic || [];
  if (traffic.length === 0 || traffic.every((row) => row.value === 0)) {
    return <NoData label="No API traffic in the last 7 days." />;
  }
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <BarChart
        rows={traffic.map((row) => ({
          label: row.label,
          value: row.value,
          display: row.display,
          tone: "neutral" as const,
        }))}
      />
      <p className="text-xs text-muted-foreground">Last 7 days</p>
    </div>
  );
}

function renderRequests(data: Data) {
  const volume = data.requestVolume;
  if (!volume || volume.total === 0) {
    return <NoData label="No API requests recorded yet." />;
  }
  return (
    <StatCard
      label={`${volume.days}-day requests`}
      value={new Intl.NumberFormat(undefined, {
        notation: volume.total >= 10000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(volume.total)}
      hint={volume.label}
    />
  );
}

function renderAdvisors(data: Data) {
  const advisors = data.advisors;
  if (!advisors) {
    return <NoData label="No advisor data available." />;
  }
  if (advisors.total === 0) {
    return (
      <StatCard
        label="Security findings"
        value="0"
        hint="No open issues"
        trend="Clean"
        trendTone="positive"
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <StatCard
        label="Security findings"
        value={String(advisors.total)}
        hint={`${advisors.errors} errors · ${advisors.warnings} warnings`}
        trendTone={advisors.errors > 0 ? "negative" : "neutral"}
        trend={advisors.errors > 0 ? "Needs attention" : "Review suggested"}
      />
      {advisors.top && advisors.top.length > 0 ? (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-auto text-xs text-muted-foreground">
          {advisors.top.slice(0, 3).map((item, index) => (
            <li key={`${item.title}-${index}`} className="truncate">
              <span className="font-medium text-foreground/80">
                {item.level}
              </span>{" "}
              · {item.title}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function renderAdvisorIssues(data: Data) {
  const issues = data.advisorIssues || [];
  if (issues.length === 0) {
    return <NoData label="No advisor findings — nothing to fix." />;
  }
  return (
    <DataTable
      data={issues}
      rowKey={(issue) => issue.id}
      columns={[
        {
          header: "Finding",
          render: (issue) => (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{issue.title}</span>
              <span className="truncate text-xs text-muted-foreground">
                {issue.projectName} · {issue.kind}
              </span>
            </div>
          ),
        },
        {
          header: "Level",
          align: "right",
          render: (issue) => (
            <Badge variant={toneBadgeVariant(issue.status)}>
              {issue.level}
            </Badge>
          ),
        },
      ]}
    />
  );
}

export const supabaseRenderers: RenderersFor<"supabase"> = {
  "supabase-health": renderHealth,
  "supabase-projects": (data) => {
    const items = data.items || [];
    if (items.length === 0) {
      return <NoData label="No Supabase projects found." />;
    }
    return <StatusList items={items} />;
  },
  "supabase-services": renderServices,
  "supabase-traffic": renderTraffic,
  "supabase-requests": renderRequests,
  "supabase-advisors": renderAdvisors,
  "supabase-advisor-issues": renderAdvisorIssues,
};
