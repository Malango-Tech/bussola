import { alertEventsRepo } from "./repos/alert-events";
import { alertRulesRepo } from "./repos/alert-rules";
import { apiTokensRepo } from "./repos/api-tokens";
import { cacheRepo } from "./repos/cache";
import { channelsRepo } from "./repos/channels";
import { connectionsRepo } from "./repos/connections";
import type { TenantContext } from "./repos/context";
import { dashboardsRepo } from "./repos/dashboards";
import { membersRepo } from "./repos/members";
import { sharesRepo } from "./repos/shares";
import { snapshotRepo } from "./repos/snapshots";
import { widgetsRepo } from "./repos/widgets";

export type { TenantContext } from "./repos/context";
export {
  snapshotRepo,
  type ConnectionSnapshotView,
  type SnapshotRepo,
} from "./repos/snapshots";

/**
 * Every query against tenant-owned data goes through here, and every one of
 * them is filtered by `organization_id` before it touches a row. Route handlers
 * are barred from importing `lib/db` or `lib/db/schema` directly (enforced by
 * `no-restricted-imports` in eslint.config.mjs), so the repositories composed
 * below are the only place where forgetting the tenant filter is even possible.
 *
 * Each repository lives in its own module under `./repos`, built from the same
 * context, so a reviewer checking the isolation of one table reads one file.
 * The composition — and therefore the shape callers see — is this function.
 */
export function forTenant(ctx: TenantContext) {
  const org = ctx.organizationId;

  return {
    ctx,
    dashboards: dashboardsRepo(ctx),
    widgets: widgetsRepo(ctx),
    connections: connectionsRepo(ctx),
    members: membersRepo(ctx),
    snapshots: snapshotRepo(org),
    shares: sharesRepo(ctx),
    channels: channelsRepo(ctx),
    alertRules: alertRulesRepo(ctx),
    alertEvents: alertEventsRepo(ctx),
    apiTokens: apiTokensRepo(ctx),
    cache: cacheRepo(org),
  };
}

export type TenantRepos = ReturnType<typeof forTenant>;
