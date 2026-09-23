import type {
  ConnectionCredentials,
  Connector,
  StatusItem,
  SupabaseAdvisorIssue,
  SupabaseAdvisorsSummary,
  SupabaseDashboard,
  SupabaseServiceItem,
  SupabaseTrafficBucket,
  TestResult,
  TrackerPoint,
} from "./types";
import { friendlyStatusLabel, toUserFacingError } from "./errors";
import { fetchJson } from "./http";
import { connectorLogger, describeError } from "./shared/log";

const BASE = "https://api.supabase.com/v1";
const USAGE_INTERVAL = "7day";
const MAX_DETAIL_PROJECTS = 8;

const log = connectorLogger("supabase");

/** Normalize copy-pasted tokens (Bearer prefix, quotes, whitespace). */
export function normalizeSupabaseToken(raw: string): string {
  let token = raw.trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  token = token.replace(/^Bearer\s+/i, "").trim();
  token = token.replace(/\s+/g, "");
  return token;
}

function validateSupabaseToken(token: string): string | null {
  if (!token) return "Personal access token required";
  if (token.startsWith("eyJ")) {
    return "This looks like a project API key. Use a personal access token (sbp_…) from Account → Access Tokens.";
  }
  return null;
}

async function supabaseFetch<T>(token: string, path: string): Promise<T> {
  return fetchJson<T>(
    `${BASE}${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
    { label: "Supabase" },
  );
}

type SupabaseProject = {
  id: string;
  ref?: string;
  name: string;
  status: string;
  region?: string;
  created_at?: string;
};

type ServiceHealthRaw = {
  name?: string;
  service?: string;
  healthy?: boolean;
  status?: string;
  info?: { name?: string; healthy?: boolean; status?: string };
};

type UsageRow = {
  timestamp?: string;
  total_auth_requests?: number;
  total_realtime_requests?: number;
  total_rest_requests?: number;
  total_storage_requests?: number;
};

type AdvisorLint = {
  name?: string;
  title?: string;
  level?: string;
  description?: string;
  detail?: string;
  categories?: string[];
  remediation?: string;
  kind?: "security" | "performance";
};

function projectRef(project: SupabaseProject): string {
  return project.ref || project.id;
}

function mapProjectStatus(status: string): TrackerPoint["status"] {
  const s = status.toLowerCase();
  if (s === "active_healthy" || s === "active") return "ok";
  if (s.includes("fail") || s.includes("inactive") || s.includes("unhealthy")) {
    return "error";
  }
  if (
    s.includes("coming") ||
    s.includes("restor") ||
    s.includes("paus") ||
    s.includes("upgrad")
  ) {
    return "warn";
  }
  return "idle";
}

function mapServiceStatus(
  healthy: boolean | undefined,
  status?: string,
): TrackerPoint["status"] {
  // The health endpoint reports its own three-value enum, which is narrower
  // than a project's lifecycle status.
  switch (status?.toUpperCase()) {
    case "ACTIVE_HEALTHY":
      return "ok";
    case "COMING_UP":
      return "warn";
    case "UNHEALTHY":
      return "error";
  }
  if (typeof healthy === "boolean") return healthy ? "ok" : "error";
  if (!status) return "idle";
  return mapProjectStatus(status);
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

function serviceDisplayName(raw: string): string {
  const key = raw.toLowerCase();
  switch (key) {
    case "db":
    case "database":
    case "postgres":
      return "Database";
    case "auth":
    case "gotrue":
      return "Auth";
    case "storage":
      return "Storage";
    case "realtime":
      return "Realtime";
    case "functions":
    case "edge_functions":
    case "edge-functions":
      return "Edge Functions";
    case "rest":
    case "postgrest":
      return "PostgREST";
    default:
      return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
}

/**
 * The complete set the health endpoint accepts. Anything else is rejected
 * outright, and `services` is required — omitting it 400s rather than
 * defaulting to all of them.
 */
const HEALTH_SERVICES = ["db", "rest", "auth", "realtime", "storage"] as const;

async function fetchProjectHealth(
  token: string,
  ref: string,
): Promise<ServiceHealthRaw[]> {
  try {
    const data = await supabaseFetch<ServiceHealthRaw[] | { services?: ServiceHealthRaw[] }>(
      token,
      `/projects/${encodeURIComponent(ref)}/health?services=${HEALTH_SERVICES.join(",")}&timeout_ms=2000`,
    );
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.services)) return data.services;
    return [];
  } catch (error) {
    // The project's service rows go missing, which reads as "nothing to
    // report" rather than "down" — worth being able to tell apart.
    log.warn("service health unavailable", { ref }, error);
    return [];
  }
}

/**
 * Edge Functions have no entry in the health endpoint's service enum, so their
 * row comes from the deployment state of the functions themselves. That is a
 * weaker signal than a liveness probe — it says the functions are deployed and
 * not throttled, not that they are currently serving — and the detail text says
 * so rather than dressing it up as health.
 */
async function fetchFunctionsHealth(
  token: string,
  ref: string,
): Promise<{ status: TrackerPoint["status"]; detail: string } | null> {
  try {
    const fns = await supabaseFetch<Array<{ status?: string }>>(
      token,
      `/projects/${encodeURIComponent(ref)}/functions`,
    );
    if (!Array.isArray(fns) || fns.length === 0) return null;

    const active = fns.filter((f) => f.status === "ACTIVE").length;
    const throttled = fns.filter((f) => f.status === "THROTTLED").length;
    return {
      status: throttled > 0 ? "warn" : active === fns.length ? "ok" : "warn",
      detail: throttled > 0
        ? `${throttled} of ${fns.length} throttled`
        : `${active} deployed`,
    };
  } catch (error) {
    log.debug("edge functions unavailable", {
      ref,
      reason: describeError(error),
    });
    return null;
  }
}

async function fetchProjectUsage(
  token: string,
  ref: string,
): Promise<UsageRow[]> {
  try {
    const data = await supabaseFetch<{ result?: UsageRow[]; error?: unknown }>(
      token,
      `/projects/${encodeURIComponent(ref)}/analytics/endpoints/usage.api-counts?interval=${USAGE_INTERVAL}`,
    );
    return data.result || [];
  } catch (error) {
    // Analytics is rate limited well below the rest of the API (see the
    // batching in fetchSupabaseDashboard), so a miss here is routine.
    log.debug("usage analytics unavailable", {
      ref,
      reason: describeError(error),
    });
    return [];
  }
}

/**
 * Two lints that mean "we could not check", not "we found a problem". Counting
 * them would report a paused project as having findings.
 */
const NON_FINDING_LINTS = new Set(["advisor_check_unavailable", "project_not_active"]);

async function fetchAdvisorKind(
  token: string,
  ref: string,
  kind: "security" | "performance",
): Promise<AdvisorLint[]> {
  try {
    const data = await supabaseFetch<{ lints?: AdvisorLint[] } | AdvisorLint[]>(
      token,
      `/projects/${encodeURIComponent(ref)}/advisors/${kind}`,
    );
    const lints = Array.isArray(data) ? data : data.lints || [];
    return lints
      .filter((lint) => !NON_FINDING_LINTS.has(lint.name || ""))
      .map((lint) => ({ ...lint, kind }));
  } catch (error) {
    // The security endpoint is flagged experimental, so one kind failing must
    // not take the other down with it.
    log.debug("advisors unavailable", {
      ref,
      kind,
      reason: describeError(error),
    });
    return [];
  }
}

async function fetchProjectAdvisors(
  token: string,
  ref: string,
): Promise<AdvisorLint[]> {
  const [security, performance] = await Promise.all([
    fetchAdvisorKind(token, ref, "security"),
    fetchAdvisorKind(token, ref, "performance"),
  ]);
  return [...security, ...performance];
}

function normalizeServices(
  projectName: string,
  projectId: string,
  rows: ServiceHealthRaw[],
): SupabaseServiceItem[] {
  return rows
    .map((row, index) => {
      const rawName =
        row.name ||
        row.service ||
        row.info?.name ||
        `service-${index}`;
      // `healthy` is marked deprecated in favour of `status`, so `status` wins
      // and the boolean is only a fallback for older responses.
      const statusText = row.status || row.info?.status;
      const healthy =
        typeof row.healthy === "boolean"
          ? row.healthy
          : typeof row.info?.healthy === "boolean"
            ? row.info.healthy
            : undefined;
      const status = statusText
        ? mapServiceStatus(undefined, statusText)
        : mapServiceStatus(healthy, undefined);
      const serviceName = serviceDisplayName(rawName);
      return {
        id: `${projectId}:${rawName}`,
        projectName,
        serviceName,
        status,
        healthy: status === "ok",
        detail:
          statusText ||
          (status === "ok" ? "Healthy" : friendlyStatusLabel(status)),
      };
    })
    .filter((s) => Boolean(s.serviceName));
}

export const supabaseConnector: Connector<
  SupabaseDashboard,
  "supabase"
> = {
  provider: "supabase",
  fetchDashboard: (credentials) =>
    fetchSupabaseDashboard(credentials.apiKey || ""),
  async test(credentials: ConnectionCredentials): Promise<TestResult> {
    const token = normalizeSupabaseToken(credentials.apiKey || "");
    const validationError = validateSupabaseToken(token);
    if (validationError) {
      return { ok: false, message: validationError };
    }
    try {
      const projects = await supabaseFetch<SupabaseProject[]>(token, "/projects");
      return {
        ok: true,
        message: `Connected — ${projects.length} project(s)`,
      };
    } catch (error) {
      return {
        ok: false,
        message: toUserFacingError(error, "supabase"),
      };
    }
  },
};

export async function fetchSupabaseDashboard(
  apiKey: string,
): Promise<SupabaseDashboard> {
  const token = normalizeSupabaseToken(apiKey);
  const validationError = validateSupabaseToken(token);
  if (validationError) {
    throw new Error(validationError);
  }

  const projects = await supabaseFetch<SupabaseProject[]>(token, "/projects");
  const items: StatusItem[] = projects.map((p) => {
    const status = mapProjectStatus(p.status);
    return {
      id: projectRef(p),
      name: p.name,
      provider: "supabase" as const,
      status,
      detail: p.region
        ? `${friendlyStatusLabel(status)} · ${p.region}`
        : friendlyStatusLabel(status),
      updatedAt: p.created_at,
    };
  });
  const healthy = items.filter((i) => i.status === "ok").length;

  const detailProjects = projects.slice(0, MAX_DETAIL_PROJECTS);
  const services: SupabaseServiceItem[] = [];
  let auth = 0;
  let rest = 0;
  let storage = 0;
  let realtime = 0;
  let usageAvailable = false;

  const advisorIssues: SupabaseAdvisorIssue[] = [];
  const advisorSummary: SupabaseAdvisorsSummary = {
    total: 0,
    errors: 0,
    warnings: 0,
    infos: 0,
    projectCount: 0,
    top: [],
  };

  // Sequential-ish batches to respect analytics rate limits (30/min).
  for (const project of detailProjects) {
    const ref = projectRef(project);
    const [healthRows, usageRows, lints, functions] = await Promise.all([
      fetchProjectHealth(token, ref),
      fetchProjectUsage(token, ref),
      fetchProjectAdvisors(token, ref),
      fetchFunctionsHealth(token, ref),
    ]);

    services.push(...normalizeServices(project.name, ref, healthRows));
    if (functions) {
      services.push({
        id: `${ref}:functions`,
        projectName: project.name,
        serviceName: "Edge Functions",
        status: functions.status,
        healthy: functions.status === "ok",
        detail: functions.detail,
      });
    }

    if (usageRows.length > 0) {
      usageAvailable = true;
      for (const row of usageRows) {
        auth += row.total_auth_requests || 0;
        rest += row.total_rest_requests || 0;
        storage += row.total_storage_requests || 0;
        realtime += row.total_realtime_requests || 0;
      }
    }

    if (lints.length > 0) {
      advisorSummary.projectCount += 1;
    }
    for (const lint of lints) {
      advisorSummary.total += 1;
      const level = (lint.level || "INFO").toUpperCase();
      if (level === "ERROR") advisorSummary.errors += 1;
      else if (level === "WARN") advisorSummary.warnings += 1;
      else advisorSummary.infos += 1;

      advisorIssues.push({
        id: `${ref}:${lint.name || advisorIssues.length}`,
        name: lint.name || "advisor_finding",
        title: lint.title || lint.name || "Advisor finding",
        level: level === "ERROR" || level === "WARN" ? level : "INFO",
        status: level === "ERROR" ? "error" : level === "WARN" ? "warn" : "idle",
        kind: lint.kind || "security",
        projectName: project.name,
        detail: lint.description || lint.detail,
      });

      if ((advisorSummary.top?.length || 0) < 5) {
        advisorSummary.top = [
          ...(advisorSummary.top || []),
          {
            title: lint.title || lint.name || "Advisor finding",
            level,
            projectName: project.name,
          },
        ];
      }
    }
  }

  const traffic: SupabaseTrafficBucket[] = usageAvailable
    ? [
        { label: "PostgREST", value: rest, display: formatCount(rest) },
        { label: "Auth", value: auth, display: formatCount(auth) },
        { label: "Storage", value: storage, display: formatCount(storage) },
        { label: "Realtime", value: realtime, display: formatCount(realtime) },
      ]
    : [];

  const requestTotal = auth + rest + storage + realtime;

  return {
    items,
    healthy,
    total: items.length,
    services,
    traffic,
    requestVolume: {
      total: requestTotal,
      days: 7,
      label: usageAvailable
        ? `Across ${detailProjects.length} project${detailProjects.length === 1 ? "" : "s"} · 7 days`
        : "No usage data yet",
    },
    advisors: advisorSummary,
    // Errors first, then warnings — the list is read top-down for what to fix.
    advisorIssues: advisorIssues.sort((a, b) => {
      const rank = { ERROR: 0, WARN: 1, INFO: 2 } as const;
      return rank[a.level] - rank[b.level];
    }),
  };
}

/** Back-compat for status-board and older callers. */
export async function fetchSupabaseProjects(apiKey: string): Promise<{
  items: StatusItem[];
  healthy: number;
  total: number;
}> {
  const dash = await fetchSupabaseDashboard(apiKey);
  return { items: dash.items, healthy: dash.healthy, total: dash.total };
}
