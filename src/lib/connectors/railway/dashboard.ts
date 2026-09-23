import type {
  RailwayDashboard,
  RailwayDeployHealth,
  RailwayDeployItem,
  RailwayFleetHealth,
  RailwayMetrics,
  RailwayProjectSummary,
  RailwayResourceSnapshot,
  StatusItem,
  TrackerPoint,
} from "../types";
import { byNewest } from "../shared/dates";
import { resolveRailwayAuth } from "./client";
import { fetchBilling } from "./billing";
import {
  buildDeployTrail,
  buildServiceDeployHealth,
  fetchDeployments,
  pickPrimaryDeployHealth,
} from "./deploys";
import {
  fetchEnvironmentMetrics,
  fetchEnvironmentSeries,
  SERIES_HOURS,
} from "./metrics";
import { fetchProjects, pickEnvironmentId } from "./projects";
import {
  deployStage,
  isHealthyService,
  isLiveCandidateStatus,
  readDeployMeta,
  statusColor,
} from "./status";
import { fetchEstimatedUsage } from "./usage";

const RECENT_DEPLOYS = 25;

export async function fetchRailwayDashboard(
  apiKey: string,
): Promise<RailwayDashboard> {
  const token = apiKey.trim();
  const auth = await resolveRailwayAuth(token);
  const projects = await fetchProjects(token, auth);

  const items: StatusItem[] = [];
  const trackers: Record<string, TrackerPoint[]> = {};
  const deployHealthCandidates: RailwayDeployHealth[] = [];
  const recentDeploys: RailwayDeployItem[] = [];
  const serviceNameById = new Map<string, { name: string; projectName: string }>();
  const environmentIds = new Set<string>();
  const projectSummaries: RailwayProjectSummary[] = [];
  /** The project the usage charts describe: whichever runs the most services. */
  let primaryEnv: {
    id: string;
    projectName: string;
    envName?: string;
    serviceCount: number;
  } | null = null;

  for (const project of projects) {
    const environmentId = pickEnvironmentId(project, auth.environmentId);
    if (environmentId) environmentIds.add(environmentId);
    let projectHealthy = 0;
    let projectFailed = 0;
    let projectServices = 0;
    let projectUpdatedAt: string | undefined;

    // Prefer project-wide deploy list when possible.
    const projectDeploys = await fetchDeployments(token, auth.mode, {
      projectId: project.id,
      environmentId,
      first: RECENT_DEPLOYS,
      swallow: true,
    });

    for (const serviceEdge of project.services.edges) {
      const service = serviceEdge.node;
      serviceNameById.set(service.id, {
        name: service.name,
        projectName: project.name,
      });

      const instance =
        service.serviceInstances.edges.find(
          (e) => !environmentId || e.node.environmentId === environmentId,
        )?.node || service.serviceInstances.edges[0]?.node;

      const latest = instance?.latestDeployment;
      const status = statusColor(latest?.status || "UNKNOWN");
      projectServices += 1;
      if (status === "ok") projectHealthy += 1;
      if (status === "error" || status === "warn") projectFailed += 1;
      if (
        latest?.createdAt &&
        (!projectUpdatedAt || latest.createdAt > projectUpdatedAt)
      ) {
        projectUpdatedAt = latest.createdAt;
      }
      const instanceEnv = instance?.environmentId || environmentId;
      if (instanceEnv) environmentIds.add(instanceEnv);

      let deployments = projectDeploys.filter((d) => d.serviceId === service.id);
      const hasLive = deployments.some((d) => isLiveCandidateStatus(d.status));
      if (deployments.length === 0 || !hasLive) {
        try {
          const serviceDeploys = await fetchDeployments(token, auth.mode, {
            projectId: project.id,
            environmentId,
            serviceId: service.id,
            first: 48,
          });
          if (serviceDeploys.length > 0) deployments = serviceDeploys;
        } catch {
          // Keep whatever project-level list we already have.
        }
      }

      // Ensure latestDeployment is represented even if list is thin.
      if (
        latest?.id &&
        !deployments.some((d) => d.id === latest.id)
      ) {
        deployments = [
          {
            id: latest.id,
            status: latest.status,
            createdAt: latest.createdAt,
            serviceId: service.id,
            meta: latest.meta,
          },
          ...deployments,
        ];
      }

      const trail = buildDeployTrail(deployments, service.name, latest?.status);
      const health = buildServiceDeployHealth(deployments, {
        id: service.id,
        name: service.name,
        projectName: project.name,
      });
      deployHealthCandidates.push(health);

      const behindHint =
        health.behindCount > 0
          ? `${health.behindCount} behind live`
          : health.active.status === "crashed"
            ? "Live crashed"
            : health.active.status === "healthy"
              ? "Up to date"
              : trail.detail;

      items.push({
        id: service.id,
        name: `${project.name} / ${service.name}`,
        provider: "railway",
        status,
        detail: behindHint,
        updatedAt: health.active.createdAt || latest?.createdAt,
      });
      trackers[service.id] = trail.points;

      for (const d of deployments) {
        recentDeploys.push({
          id: d.id,
          serviceId: service.id,
          serviceName: service.name,
          projectName: project.name,
          status: statusColor(d.status),
          rawStatus: d.status,
          createdAt: d.createdAt,
          ...readDeployMeta(d.meta),
          stage: deployStage(d.status, d.meta),
        });
      }
    }

    // Project-level deploys not tied above (edge case).
    for (const d of projectDeploys) {
      if (recentDeploys.some((x) => x.id === d.id)) continue;
      const named = serviceNameById.get(d.serviceId);
      recentDeploys.push({
        id: d.id,
        serviceId: d.serviceId,
        serviceName: named?.name || "Service",
        projectName: named?.projectName || project.name,
        status: statusColor(d.status),
        rawStatus: d.status,
        createdAt: d.createdAt,
        ...readDeployMeta(d.meta),
        stage: deployStage(d.status, d.meta),
      });
    }

    // A project is only as healthy as its worst service — one crashed service
    // is the thing worth seeing from a list of projects.
    const projectStatus: TrackerPoint["status"] =
      projectServices === 0
        ? "idle"
        : projectFailed > 0
          ? "error"
          : projectHealthy === projectServices
            ? "ok"
            : "warn";

    projectSummaries.push({
      id: project.id,
      name: project.name,
      serviceCount: projectServices,
      healthy: projectHealthy,
      failed: projectFailed,
      status: projectStatus,
      detail:
        projectServices === 0
          ? "No services"
          : `${projectServices} service${projectServices === 1 ? "" : "s"}` +
            (projectFailed > 0 ? ` · ${projectFailed} failing` : ""),
      updatedAt: projectUpdatedAt,
    });

    if (environmentId && projectServices > 0) {
      if (!primaryEnv || projectServices > (primaryEnv.serviceCount ?? 0)) {
        primaryEnv = {
          id: environmentId,
          projectName: project.name,
          envName: project.environments?.edges.find(
            (e) => e.node.id === environmentId,
          )?.node.name,
          serviceCount: projectServices,
        };
      }
    }
  }

  projectSummaries.sort((a, b) => b.serviceCount - a.serviceCount);

  recentDeploys.sort(byNewest((d) => d.createdAt));

  const deployHealth = pickPrimaryDeployHealth(deployHealthCandidates);

  const fleet: RailwayFleetHealth = {
    healthy: items.filter((i) => isHealthyService(i.status)).length,
    total: items.length,
    crashed: items.filter((i) => i.status === "error").length,
    sleeping: items.filter((i) => i.status === "idle").length,
    degraded: items.filter((i) => i.status === "warn").length,
  };

  // Metrics — sample up to 3 environments.
  const cpuSamples: number[] = [];
  const memorySamples: number[] = [];
  for (const envId of [...environmentIds].slice(0, 3)) {
    const metrics = await fetchEnvironmentMetrics(token, auth.mode, envId);
    cpuSamples.push(...metrics.cpu);
    memorySamples.push(...metrics.memory);
  }

  const avg = (values: number[]) =>
    values.length
      ? values.reduce((sum, v) => sum + v, 0) / values.length
      : null;

  const sampled = Math.max(cpuSamples.length, memorySamples.length);
  const resources: RailwayResourceSnapshot = {
    cpuCores: avg(cpuSamples),
    memoryGb: avg(memorySamples),
    sampledServices: sampled,
    label:
      sampled > 0
        ? `Avg · last hour · ${sampled} series`
        : "No metrics in the last hour",
  };

  const billing = await fetchBilling(token, auth.mode, auth.workspaceId);

  const usage = await fetchEstimatedUsage(
    token,
    auth.mode,
    projects.map((p) => p.id),
  );

  let metrics: RailwayMetrics | null = null;
  if (primaryEnv) {
    try {
      const series = await fetchEnvironmentSeries(token, auth.mode, primaryEnv.id);
      if (series.length > 0) {
        metrics = {
          projectName: primaryEnv.projectName,
          environmentName: primaryEnv.envName,
          hours: SERIES_HOURS,
          series,
        };
      }
    } catch {
      // Charts degrade to their empty state; the rest of the dashboard stands.
    }
  }

  return {
    items,
    trackers,
    deployHealth,
    fleet,
    recentDeploys: recentDeploys.slice(0, RECENT_DEPLOYS),
    resources,
    usage,
    projects: projectSummaries,
    metrics,
    billing,
  };
}
