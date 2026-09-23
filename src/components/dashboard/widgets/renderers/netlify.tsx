import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/widgets/stat-card";
import { ActivityTracker } from "@/components/dashboard/widgets/activity-tracker";
import { BarChart } from "@/components/dashboard/widgets/bar-chart";
import { DataTable } from "@/components/dashboard/widgets/data-table";
import { StatusList } from "@/components/dashboard/widgets/status-list";
import { NoData } from "@/components/dashboard/widgets/widget-messages";
import { deployBadgeVariant } from "@/lib/widgets/widget-format";
import type { ServedSnapshot } from "@/lib/widgets/snapshots";
import type { RenderersFor } from "./types";

type Data = ServedSnapshot<"netlify">;

function renderTracker(data: Data) {
  const items = data.items || [];
  const trackers = data.trackers || {};
  const first = items[0];
  const points = first ? trackers[first.id] || [] : [];

  if (!first) {
    return <NoData label="No sites found for this connection." />;
  }
  if (points.length === 0) {
    return <NoData label="No deployment history yet." />;
  }

  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <p className="truncate text-sm font-medium">{first.name}</p>
      <ActivityTracker
        data={points}
        label={`Deploy history for ${first.name}`}
        hoverEffect
      />
      <p className="text-xs text-muted-foreground">
        {first.detail}
        {items.length > 1 ? ` · +${items.length - 1} more` : ""}
      </p>
    </div>
  );
}

function renderHealth(data: Data) {
  const healthy = data.healthy || 0;
  const total = data.total || 0;
  if (total === 0) {
    return <NoData label="No Netlify sites found." />;
  }
  return (
    <StatCard
      label="Ready sites"
      value={`${healthy}/${total}`}
      hint={total === 1 ? "1 site" : `${total} sites`}
      trend={healthy === total ? "All ready" : undefined}
      trendTone={healthy === total ? "positive" : "neutral"}
    />
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
          header: "Site",
          render: (deploy) => (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{deploy.siteName}</span>
              {deploy.branch ? (
                <span className="truncate text-xs text-muted-foreground">
                  {deploy.branch}
                </span>
              ) : null}
            </div>
          ),
        },
        {
          header: "Status",
          render: (deploy) => (
            <Badge variant={deployBadgeVariant(deploy.status)}>
              {deploy.rawState.replace(/_/g, " ")}
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

function renderBuilds(data: Data) {
  const builds = data.buildMinutes;
  if (!builds) {
    return (
      <NoData label="No build-minute data for this account/token." />
    );
  }
  const tone =
    builds.deltaPct == null
      ? "neutral"
      : builds.deltaPct > 10
        ? "negative"
        : builds.deltaPct < -10
          ? "positive"
          : "neutral";
  return (
    <StatCard
      label="Build minutes"
      value={String(builds.current)}
      hint={builds.label}
      trend={
        builds.deltaPct == null
          ? builds.previous > 0
            ? `Prev ${builds.previous}`
            : undefined
          : `${builds.deltaPct > 0 ? "+" : ""}${builds.deltaPct}% vs prior`
      }
      trendTone={tone}
    />
  );
}

function renderForms(data: Data) {
  const forms = data.forms || [];
  const total = data.formSubmissionsTotal || 0;
  if (forms.length === 0) {
    return <NoData label="No Netlify Forms on connected sites." />;
  }
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <BarChart
        rows={forms.slice(0, 5).map((form) => ({
          label: `${form.name} · ${form.siteName}`,
          value: form.submissionCount,
          display: String(form.submissionCount),
          tone: "neutral" as const,
        }))}
      />
      <p className="text-xs text-muted-foreground">
        {total} total submissions
        {forms.length > 5 ? ` · top 5 of ${forms.length}` : ""}
      </p>
    </div>
  );
}

export const netlifyRenderers: RenderersFor<"netlify"> = {
  "netlify-tracker": renderTracker,
  "netlify-sites": (data) => {
    const items = data.items || [];
    if (items.length === 0) {
      return <NoData label="No Netlify sites found." />;
    }
    return <StatusList items={items} />;
  },
  "netlify-health": renderHealth,
  "netlify-deploys": renderDeploys,
  "netlify-builds": renderBuilds,
  "netlify-forms": renderForms,
};
