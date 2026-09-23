import type {
  ConnectionCredentials,
  Connector,
  StatusItem,
  TestResult,
  TrackerPoint,
  VercelDashboard,
  VercelDeployItem,
} from "./types";
import { toUserFacingError } from "./errors";
import { fetchJson } from "./http";
import { toneClass } from "./shared/tone";

const BASE = "https://api.vercel.com";
const MAX_PROJECTS = 20;
const RECENT_DEPLOYS = 30;
const DEPLOY_TRAIL_LEN = 24;

async function vercelFetch<T>(
  token: string,
  path: string,
  teamId?: string,
): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const url = teamId ? `${BASE}${path}${separator}teamId=${teamId}` : `${BASE}${path}`;
  return fetchJson<T>(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    { label: "Vercel" },
  );
}

type VercelProject = { id: string; name: string; updatedAt?: number };

type VercelDeployment = {
  uid: string;
  name?: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  created?: number;
  createdAt?: number;
  url?: string;
  meta?: {
    githubCommitMessage?: string;
    githubCommitRef?: string;
    gitlabCommitMessage?: string;
    gitlabCommitRef?: string;
  };
};

export function deployStatus(state?: string): TrackerPoint["status"] {
  switch (state) {
    case "READY":
      return "ok";
    case "ERROR":
      return "error";
    case "BUILDING":
    case "QUEUED":
    case "INITIALIZING":
      return "warn";
    case "CANCELED":
      return "idle";
    default:
      return "idle";
  }
}

export function deployStateLabel(state?: string): string {
  if (!state) return "Unknown";
  return state.charAt(0) + state.slice(1).toLowerCase();
}

function deploymentTime(deployment: VercelDeployment): number {
  return deployment.created ?? deployment.createdAt ?? Date.now();
}

function commitMessage(deployment: VercelDeployment): string | undefined {
  return (
    deployment.meta?.githubCommitMessage ||
    deployment.meta?.gitlabCommitMessage ||
    undefined
  );
}

function branch(deployment: VercelDeployment): string | undefined {
  return (
    deployment.meta?.githubCommitRef ||
    deployment.meta?.gitlabCommitRef ||
    undefined
  );
}

export const vercelConnector: Connector = {
  provider: "vercel",
  async test(credentials: ConnectionCredentials): Promise<TestResult> {
    const token = credentials.apiKey?.trim();
    if (!token) return { ok: false, message: "API token is required" };

    try {
      const projects = await vercelFetch<{ projects?: VercelProject[] }>(
        token,
        "/v9/projects?limit=1",
        credentials.orgSlug?.trim() || undefined,
      );
      const count = projects.projects?.length ?? 0;
      return {
        ok: true,
        message:
          count > 0 ? "Connected to Vercel" : "Connected — no projects found",
      };
    } catch (error) {
      return { ok: false, message: toUserFacingError(error, "vercel") };
    }
  },
};

export async function fetchVercelDashboard(
  credentials: ConnectionCredentials,
): Promise<VercelDashboard> {
  const token = credentials.apiKey?.trim();
  if (!token) throw new Error("Vercel API token is required");
  const teamId = credentials.orgSlug?.trim() || undefined;

  const [projectsResponse, deploymentsResponse] = await Promise.all([
    vercelFetch<{ projects?: VercelProject[] }>(
      token,
      `/v9/projects?limit=${MAX_PROJECTS}`,
      teamId,
    ),
    vercelFetch<{ deployments?: VercelDeployment[] }>(
      token,
      `/v6/deployments?limit=${RECENT_DEPLOYS}`,
      teamId,
    ),
  ]);

  const deployments = deploymentsResponse.deployments ?? [];
  const projects = projectsResponse.projects ?? [];

  // Group by project so each gets its own deploy trail, newest last.
  const byProject = new Map<string, VercelDeployment[]>();
  for (const deployment of deployments) {
    const key = deployment.name || "unknown";
    const list = byProject.get(key) ?? [];
    list.push(deployment);
    byProject.set(key, list);
  }

  const trackers: Record<string, TrackerPoint[]> = {};
  const items: StatusItem[] = [];

  for (const project of projects) {
    const history = (byProject.get(project.name) ?? [])
      .slice(0, DEPLOY_TRAIL_LEN)
      .reverse();

    trackers[project.name] = history.map((deployment) => {
      const status = deployStatus(deployment.readyState ?? deployment.state);
      return {
        key: deployment.uid,
        color: toneClass(status),
        status,
        tooltip: `${deployStateLabel(
          deployment.readyState ?? deployment.state,
        )} · ${new Date(deploymentTime(deployment)).toLocaleString()}`,
      };
    });

    const latest = history[history.length - 1];
    const status = latest
      ? deployStatus(latest.readyState ?? latest.state)
      : "idle";

    items.push({
      id: project.id,
      name: project.name,
      provider: "vercel",
      status,
      detail: latest
        ? deployStateLabel(latest.readyState ?? latest.state)
        : "No deployments",
      updatedAt: latest
        ? new Date(deploymentTime(latest)).toISOString()
        : undefined,
    });
  }

  return {
    items,
    trackers,
    ready: items.filter((item) => item.status === "ok").length,
    total: items.length,
    recentDeploys: deployments.slice(0, RECENT_DEPLOYS).map(
      (deployment): VercelDeployItem => ({
        id: deployment.uid,
        projectName: deployment.name || "unknown",
        status: deployStatus(deployment.readyState ?? deployment.state),
        rawState: deployStateLabel(deployment.readyState ?? deployment.state),
        target: deployment.target ?? undefined,
        branch: branch(deployment),
        commitMessage: commitMessage(deployment),
        createdAt: new Date(deploymentTime(deployment)).toISOString(),
        url: deployment.url,
      }),
    ),
  };
}
