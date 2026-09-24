import type {
  ConnectionCredentials,
  Connector,
  NetlifyBuildMinutes,
  NetlifyDashboard,
  NetlifyDeployItem,
  NetlifyFormItem,
  StatusItem,
  TestResult,
  TrackerPoint,
} from "./types";
import { toUserFacingError } from "./errors";
import { fetchJson } from "./http";
import { byNewest, byOldest } from "./shared/dates";
import { connectorLogger, describeError } from "./shared/log";
import { toneClass } from "./shared/tone";

const BASE = "https://api.netlify.com/api/v1";
const MAX_SITES = 20;
const DEPLOYS_PER_SITE = 24;
const RECENT_DEPLOYS = 25;

const log = connectorLogger("netlify");

async function netlifyFetch<T>(token: string, path: string): Promise<T> {
  return fetchJson<T>(
    `${BASE}${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
    { label: "Netlify" },
  );
}

function mapState(state?: string): TrackerPoint["status"] {
  switch (state) {
    case "ready":
      return "ok";
    case "error":
      return "error";
    case "building":
    case "enqueued":
    case "processing":
    case "uploading":
    case "uploaded":
    case "preparing":
    case "prepared":
    case "processed":
    case "new":
    case "pending_review":
    case "retrying":
      return "warn";
    default:
      return "idle";
  }
}

function deployStateLabel(state?: string): string {
  if (!state) return "Unknown";
  return state.replace(/_/g, " ");
}

type NetlifySite = {
  id: string;
  name: string;
  url?: string;
  account_slug?: string;
  account_id?: string;
  updated_at?: string;
  published_deploy?: {
    state?: string;
    created_at?: string;
    branch?: string;
  };
};

type NetlifyDeploy = {
  id: string;
  state: string;
  created_at: string;
  branch?: string;
  name?: string;
};

type NetlifyAccount = {
  id?: string;
  slug?: string;
  name?: string;
  type_name?: string;
};

type NetlifyBuildStatus = {
  active?: number;
  pending_concurrency?: number;
  enqueued?: number;
  build_count?: number;
  minutes?: {
    current?: number;
    current_average_sec?: number;
    previous?: number;
    period_start_date?: string;
    period_end_date?: string;
  };
};

type NetlifyForm = {
  id: string;
  name?: string;
  site_id?: string;
  submission_count?: number;
};

function buildDeployTrail(
  deploys: NetlifyDeploy[],
  siteName: string,
  fallbackState?: string,
): { points: TrackerPoint[]; detail: string } {
  const chronological = [...deploys]
    .sort(byOldest((d) => d.created_at))
    .slice(-DEPLOYS_PER_SITE);

  if (chronological.length === 0) {
    if (!fallbackState) {
      return { points: [], detail: "No deploys yet" };
    }
    const status = mapState(fallbackState);
    return {
      points: [
        {
          key: "published",
          color: toneClass(status),
          tooltip: `${siteName}: ${deployStateLabel(fallbackState)}`,
          status,
        },
      ],
      detail: `Latest · ${deployStateLabel(fallbackState)}`,
    };
  }

  const points = chronological.map((d) => {
    const status = mapState(d.state);
    return {
      key: d.id,
      color: toneClass(status),
      tooltip: `${deployStateLabel(d.state)}${d.branch ? ` · ${d.branch}` : ""}`,
      status,
    };
  });

  const latest = chronological[chronological.length - 1];
  const issues = chronological.filter((d) => {
    const s = mapState(d.state);
    return s === "error" || s === "warn";
  }).length;

  return {
    points,
    detail:
      issues > 0
        ? `${chronological.length} deploys · ${issues} issues · ${deployStateLabel(latest.state)}`
        : `${chronological.length} deploys · ${deployStateLabel(latest.state)}`,
  };
}

async function fetchAccountBuildMinutes(
  token: string,
  accountId: string,
): Promise<NetlifyBuildMinutes | null> {
  try {
    const rows = await netlifyFetch<NetlifyBuildStatus[]>(
      token,
      `/${encodeURIComponent(accountId)}/builds/status`,
    );
    const status = rows[0];
    if (!status?.minutes) return null;

    const current = status.minutes.current ?? 0;
    const previous = status.minutes.previous ?? 0;
    const deltaPct =
      previous > 0
        ? Math.round(((current - previous) / previous) * 1000) / 10
        : null;

    return {
      current,
      previous,
      deltaPct,
      active: status.active ?? 0,
      enqueued: status.enqueued ?? 0,
      label:
        status.active || status.enqueued
          ? `${status.active ?? 0} building · ${status.enqueued ?? 0} queued`
          : "Current billing period",
    };
  } catch (error) {
    // Build status is account-level and not every token can read it; the
    // card renders its empty state.
    log.debug("build minutes unavailable", {
      accountId,
      reason: describeError(error),
    });
    return null;
  }
}

export const netlifyConnector: Connector<NetlifyDashboard, "netlify"> = {
  provider: "netlify",
  fetchDashboard: (credentials) =>
    fetchNetlifyDashboard(credentials.apiKey || ""),
  async test(credentials: ConnectionCredentials): Promise<TestResult> {
    const token = credentials.apiKey?.trim();
    if (!token) {
      return { ok: false, message: "Personal access token required" };
    }
    try {
      const sites = await netlifyFetch<NetlifySite[]>(token, "/sites?per_page=1");
      return {
        ok: true,
        message: `Connected — ${sites.length ? "sites accessible" : "no sites yet"}`,
      };
    } catch (error) {
      return {
        ok: false,
        message: toUserFacingError(error, "netlify"),
      };
    }
  },
};

export async function fetchNetlifyDashboard(
  apiKey: string,
): Promise<NetlifyDashboard> {
  const token = apiKey.trim();
  const sites = await netlifyFetch<NetlifySite[]>(
    token,
    `/sites?per_page=${MAX_SITES}`,
  );

  const items: StatusItem[] = [];
  const trackers: Record<string, TrackerPoint[]> = {};
  const recentDeploys: NetlifyDeployItem[] = [];
  const forms: NetlifyFormItem[] = [];

  for (const site of sites) {
    const state = site.published_deploy?.state || "unknown";
    const status = mapState(state);

    let deploys: NetlifyDeploy[] = [];
    try {
      deploys = await netlifyFetch<NetlifyDeploy[]>(
        token,
        `/sites/${site.id}/deploys?per_page=${DEPLOYS_PER_SITE}`,
      );
    } catch (error) {
      // The site still shows, trail reduced to its published deploy.
      log.warn("site deploys unavailable", { siteId: site.id }, error);
      deploys = [];
    }

    const trail = buildDeployTrail(
      deploys,
      site.name,
      site.published_deploy?.state,
    );

    items.push({
      id: site.id,
      name: site.name,
      provider: "netlify",
      status,
      detail: trail.detail,
      updatedAt: site.published_deploy?.created_at || site.updated_at,
    });
    trackers[site.id] = trail.points;

    for (const d of deploys) {
      recentDeploys.push({
        id: d.id,
        siteId: site.id,
        siteName: site.name,
        status: mapState(d.state),
        rawState: d.state,
        branch: d.branch,
        createdAt: d.created_at,
      });
    }

    try {
      const siteForms = await netlifyFetch<NetlifyForm[]>(
        token,
        `/sites/${site.id}/forms`,
      );
      for (const form of siteForms) {
        forms.push({
          id: form.id,
          name: form.name || "Form",
          siteName: site.name,
          submissionCount: form.submission_count || 0,
        });
      }
    } catch (error) {
      // Forms are an extra; the site's row stands without them.
      log.debug("site forms unavailable", {
        siteId: site.id,
        reason: describeError(error),
      });
    }
  }

  recentDeploys.sort(byNewest((d) => d.createdAt));
  forms.sort((a, b) => b.submissionCount - a.submissionCount);

  // Resolve account for build minutes.
  let buildMinutes: NetlifyBuildMinutes | null = null;
  const accountHint =
    sites.find((s) => s.account_slug || s.account_id)?.account_slug ||
    sites.find((s) => s.account_id)?.account_id;

  try {
    const accounts = await netlifyFetch<NetlifyAccount[]>(token, "/accounts");
    const accountId =
      accounts.find((a) => a.slug === accountHint || a.id === accountHint)?.id ||
      accounts.find((a) => a.slug === accountHint)?.slug ||
      accounts[0]?.id ||
      accounts[0]?.slug ||
      accountHint;

    if (accountId) {
      buildMinutes = await fetchAccountBuildMinutes(token, accountId);
    }
  } catch (error) {
    // Fall back to the account a site names, which is usually the same one.
    log.debug("account list unavailable", { reason: describeError(error) });
    if (accountHint) {
      buildMinutes = await fetchAccountBuildMinutes(token, accountHint);
    }
  }

  const healthy = items.filter((i) => i.status === "ok").length;

  return {
    items,
    trackers,
    healthy,
    total: items.length,
    recentDeploys: recentDeploys.slice(0, RECENT_DEPLOYS),
    buildMinutes,
    forms: forms.slice(0, 12),
    formSubmissionsTotal: forms.reduce((sum, f) => sum + f.submissionCount, 0),
  };
}
