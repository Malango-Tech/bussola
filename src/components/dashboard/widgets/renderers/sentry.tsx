import { StatCard } from "@/components/dashboard/widgets/stat-card";
import { DataTable } from "@/components/dashboard/widgets/data-table";
import {
  StatusDot,
  StatusList,
} from "@/components/dashboard/widgets/status-list";
import { NoData } from "@/components/dashboard/widgets/widget-messages";
import type { ServedSnapshot } from "@/lib/widgets/snapshots";
import type { RenderersFor } from "./types";

type Data = ServedSnapshot<"sentry">;

function renderIssues(data: Data) {
  const unresolved = data.unresolved ?? 0;
  const events = data.events24h ?? 0;
  return (
    <StatCard
      label="Unresolved issues"
      value={data.truncated ? `${unresolved}+` : String(unresolved)}
      hint={`${events.toLocaleString()} events in 24h`}
      trend={unresolved === 0 ? "All clear" : undefined}
      trendTone={unresolved === 0 ? "positive" : "neutral"}
    />
  );
}

function renderRecent(data: Data) {
  const issues = data.issues || [];
  if (issues.length === 0) {
    return <NoData label="No unresolved issues. " />;
  }
  return (
    <DataTable
      data={issues}
      rowKey={(issue) => issue.id}
      columns={[
        {
          header: "Issue",
          render: (issue) => (
            <div className="flex min-w-0 items-start gap-2">
              {/* Nothing else in the row states severity, so the dot speaks. */}
              <StatusDot status={issue.status} announce />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{issue.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {issue.projectName || issue.culprit || issue.level}
                </span>
              </div>
            </div>
          ),
        },
        {
          header: "Events",
          align: "right",
          className: "tabular-nums",
          render: (issue) => issue.count.toLocaleString(),
        },
      ]}
    />
  );
}

export const sentryRenderers: RenderersFor<"sentry"> = {
  "sentry-issues": renderIssues,
  "sentry-recent": renderRecent,
  "sentry-projects": (data) => {
    const projects = data.projects || [];
    if (projects.length === 0) {
      return <NoData label="No Sentry projects found." />;
    }
    return <StatusList items={projects} />;
  },
};
