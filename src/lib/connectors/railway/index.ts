import type {
  ConnectionCredentials,
  Connector,
  RailwayDashboard,
  TestResult,
} from "../types";
import { toUserFacingError } from "../errors";
import { resolveRailwayAuth } from "./client";
import { fetchRailwayDashboard } from "./dashboard";

/**
 * Railway: services, deploys, metrics and billing over its GraphQL API.
 *
 *   client.ts     GraphQL transport and token-kind detection
 *   projects.ts   projects → services → latest deployment
 *   status.ts     raw deploy status → tone / label / stage
 *   deploys.ts    deploy trail and "how far behind is live"
 *   metrics.ts    resource samples and time series
 *   usage.ts      estimated usage for the cycle
 *   billing.ts    workspace spend
 *   dashboard.ts  assembles the snapshot the sync worker stores
 *
 * This file is the folder's public surface; `@/lib/connectors/railway` keeps
 * resolving here, so callers never import from the modules above directly.
 */

export { deployStage, rawStatusLabel, statusColor } from "./status";
export { fetchRailwayDashboard } from "./dashboard";

export const railwayConnector: Connector<RailwayDashboard, "railway"> = {
  provider: "railway",
  fetchDashboard: (credentials) =>
    fetchRailwayDashboard(credentials.apiKey || ""),
  async test(credentials: ConnectionCredentials): Promise<TestResult> {
    const token = credentials.apiKey?.trim();
    if (!token) {
      return { ok: false, message: "API token required" };
    }
    try {
      const auth = await resolveRailwayAuth(token);
      return {
        ok: true,
        message:
          auth.mode === "project"
            ? `Connected to project “${auth.label}”`
            : `Connected as ${auth.label}`,
        meta: {
          mode: auth.mode,
          projectId: auth.projectId,
          environmentId: auth.environmentId,
        },
      };
    } catch (error) {
      return {
        ok: false,
        message: toUserFacingError(error, "railway"),
      };
    }
  },
};
