import type {
  RailwayDeployAttempt,
  RailwayDeployHealth,
  TrackerPoint,
} from "../types";
import { byNewest, byOldest } from "../shared/dates";
import { connectorLogger, describeError } from "../shared/log";
import { toneClass } from "../shared/tone";
import { railwayGraphql, type AuthMode } from "./client";
import {
  activeStatusFromRaw,
  deployStage,
  isFailedAttemptStatus,
  isInFlightStatus,
  isLiveCandidateStatus,
  rawStatusLabel,
  readDeployMeta,
  statusColor,
} from "./status";

/** Deploy history: the per-service trail, and how far live lags behind it. */

const DEPLOY_TRAIL_LEN = 24;
const FAILED_ATTEMPTS_SHOWN = 3;

const log = connectorLogger("railway");

export type DeploymentNode = {
  id: string;
  status: string;
  createdAt: string;
  serviceId: string;
  meta?: Record<string, unknown> | null;
};

function toAttempt(d: DeploymentNode): RailwayDeployAttempt {
  const { label, commitHash, branch } = readDeployMeta(d.meta);
  return {
    id: d.id,
    createdAt: d.createdAt,
    rawStatus: d.status,
    stage: deployStage(d.status, d.meta),
    label,
    commitHash,
    branch,
  };
}

/**
 * Live deploy + how many newer failed attempts sit on top of it
 * (“2 behind” when live is old SUCCESS and newer deploys FAILED).
 */
export function buildServiceDeployHealth(
  deployments: DeploymentNode[],
  service: { id: string; name: string; projectName: string },
): RailwayDeployHealth {
  const newestFirst = [...deployments].sort(byNewest((d) => d.createdAt));

  const failedSinceActive: RailwayDeployAttempt[] = [];
  let inFlight: RailwayDeployAttempt | null = null;
  let live: DeploymentNode | undefined;

  for (const d of newestFirst) {
    const s = d.status.toUpperCase();
    if (s === "REMOVED" || s === "REMOVING" || s === "SKIPPED") continue;

    if (isInFlightStatus(d.status)) {
      if (!inFlight) inFlight = toAttempt(d);
      continue;
    }

    if (isFailedAttemptStatus(d.status)) {
      if (!live) failedSinceActive.push(toAttempt(d));
      continue;
    }

    if (isLiveCandidateStatus(d.status)) {
      live = d;
      break;
    }
  }

  const liveMeta = live ? readDeployMeta(live.meta) : undefined;

  return {
    serviceId: service.id,
    serviceName: service.name,
    projectName: service.projectName,
    active:
      live && liveMeta
        ? {
            status: activeStatusFromRaw(live.status),
            createdAt: live.createdAt,
            label: liveMeta.label,
            commitHash: liveMeta.commitHash,
            rawStatus: live.status,
          }
        : { status: "unknown" },
    behindCount: failedSinceActive.length,
    failedSinceActive: failedSinceActive.slice(0, FAILED_ATTEMPTS_SHOWN),
    inFlight,
  };
}

export function pickPrimaryDeployHealth(
  candidates: RailwayDeployHealth[],
): RailwayDeployHealth | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const rank = (h: RailwayDeployHealth) => {
      if (h.active.status === "crashed") return 300 + h.behindCount;
      if (h.behindCount > 0) return 200 + h.behindCount;
      if (h.inFlight) return 100;
      if (h.active.status === "sleeping") return 10;
      if (h.active.status === "healthy") return 1;
      return 0;
    };
    return rank(b) - rank(a);
  })[0];
}

/** Honest deploy trail: last N deploys as discrete points (oldest → newest). */
export function buildDeployTrail(
  deployments: DeploymentNode[],
  serviceName: string,
  latestStatus?: string,
): { points: TrackerPoint[]; detail: string } {
  const chronological = [...deployments]
    .sort(byOldest((d) => d.createdAt))
    .slice(-DEPLOY_TRAIL_LEN);

  if (chronological.length === 0) {
    if (!latestStatus) {
      return { points: [], detail: "No deploys yet" };
    }
    const status = statusColor(latestStatus);
    return {
      points: [
        {
          key: "latest",
          color: toneClass(status),
          tooltip: `${serviceName}: ${rawStatusLabel(latestStatus)}`,
          status,
        },
      ],
      detail: `Latest · ${rawStatusLabel(latestStatus)}`,
    };
  }

  const points = chronological.map((d) => {
    const status = statusColor(d.status);
    return {
      key: d.id,
      color: toneClass(status),
      tooltip: `${serviceName}: ${rawStatusLabel(d.status)}`,
      status,
    };
  });

  const current = latestStatus || chronological[chronological.length - 1].status;
  const failed = chronological.filter(
    (d) => statusColor(d.status) === "error" || statusColor(d.status) === "warn",
  ).length;

  return {
    points,
    detail:
      failed > 0
        ? `${chronological.length} deploys · ${failed} issues · ${rawStatusLabel(current)}`
        : `${chronological.length} deploys · ${rawStatusLabel(current)}`,
  };
}

const DEPLOYMENTS_QUERY = `query ($input: DeploymentListInput!, $first: Int!) {
  deployments(input: $input, first: $first) {
    edges { node { id status createdAt serviceId meta } }
  }
}`;

export async function fetchDeployments(
  token: string,
  mode: AuthMode,
  opts: {
    projectId: string;
    environmentId?: string;
    serviceId?: string;
    first: number;
    swallow?: boolean;
  },
): Promise<DeploymentNode[]> {
  try {
    const data = await railwayGraphql<{
      deployments: { edges: Array<{ node: DeploymentNode }> };
    }>(token, DEPLOYMENTS_QUERY, mode, {
      first: opts.first,
      input: {
        projectId: opts.projectId,
        ...(opts.environmentId ? { environmentId: opts.environmentId } : {}),
        ...(opts.serviceId ? { serviceId: opts.serviceId } : {}),
      },
    });
    return data.deployments.edges.map((e) => e.node);
  } catch (error) {
    if (!opts.swallow) throw error;
    // The caller falls back to asking per service.
    log.debug("deployment list unavailable", {
      projectId: opts.projectId,
      serviceId: opts.serviceId,
      reason: describeError(error),
    });
    return [];
  }
}
