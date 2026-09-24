import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ActivityTracker } from "@/components/dashboard/widgets/activity-tracker";
import { DataTable } from "@/components/dashboard/widgets/data-table";
import { StatusList } from "@/components/dashboard/widgets/status-list";
import { NoData } from "@/components/dashboard/widgets/widget-messages";
import { deployBadgeVariant } from "@/lib/widgets/widget-format";
import type { ServedSnapshot } from "@/lib/widgets/snapshots";
import type { RenderersFor } from "./types";

type Data = ServedSnapshot<"vercel">;

function renderTracker(data: Data) {
  const trackers = data.trackers || {};
  const entries = Object.entries(trackers).filter(
    ([, points]) => points.length > 0,
  );
  if (entries.length === 0) {
    return <NoData label="No Vercel deployments yet." />;
  }
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto overscroll-contain">
      {entries.map(([name, points]) => (
        <div key={name} className="space-y-1.5">
          <p className="truncate text-xs text-muted-foreground">{name}</p>
          <ActivityTracker data={points} label={`Deploy history for ${name}`} />
        </div>
      ))}
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
          header: "Project",
          render: (deploy) => (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">
                {deploy.projectName}
              </span>
              {deploy.branch || deploy.commitMessage ? (
                <span className="truncate text-xs text-muted-foreground">
                  {deploy.commitMessage || deploy.branch}
                </span>
              ) : null}
            </div>
          ),
        },
        {
          header: "Status",
          render: (deploy) => (
            <Badge variant={deployBadgeVariant(deploy.status)}>
              {deploy.rawState}
            </Badge>
          ),
        },
        {
          header: "When",
          align: "right",
          className: "text-xs text-muted-foreground",
          render: (deploy) => format(new Date(deploy.createdAt), "d MMM, HH:mm"),
        },
      ]}
    />
  );
}

export const vercelRenderers: RenderersFor<"vercel"> = {
  "vercel-tracker": renderTracker,
  "vercel-projects": (data) => {
    const items = data.items || [];
    if (items.length === 0) {
      return <NoData label="No Vercel projects found." />;
    }
    return <StatusList items={items} />;
  },
  "vercel-deploys": renderDeploys,
};
