import type {
  ConnectionCredentials,
  Connector,
  SentryDashboard,
  SentryIssueItem,
  StatusItem,
  TestResult,
  TrackerPoint,
} from "./types";
import { toUserFacingError } from "./errors";
import { fetchJson } from "./http";
import { connectorLogger, describeError } from "./shared/log";

const BASE = "https://sentry.io/api/0";
const ISSUE_LIMIT = 25;
const PROJECT_LIMIT = 20;

const log = connectorLogger("sentry");

async function sentryFetch<T>(token: string, path: string): Promise<T> {
  return fetchJson<T>(
    `${BASE}${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
    { label: "Sentry" },
  );
}

type SentryOrganization = { slug: string; name?: string };

type SentryProject = {
  id: string;
  slug: string;
  name?: string;
  status?: string;
  hasAccess?: boolean;
  firstEvent?: string | null;
};

type SentryIssue = {
  id: string;
  title: string;
  culprit?: string;
  level?: string;
  status?: string;
  count?: string | number;
  userCount?: number;
  lastSeen?: string;
  permalink?: string;
  project?: { slug?: string; name?: string };
};

/** Sentry levels, mapped onto the tone vocabulary the widgets share. */
export function levelStatus(level?: string): TrackerPoint["status"] {
  switch (level) {
    case "fatal":
    case "error":
      return "error";
    case "warning":
      return "warn";
    case "info":
    case "debug":
      return "ok";
    default:
      return "idle";
  }
}

export function projectStatus(project: {
  status?: string;
  firstEvent?: string | null;
}): TrackerPoint["status"] {
  if (project.status && project.status !== "active") return "warn";
  // A project that has never received an event is set up but not reporting.
  return project.firstEvent ? "ok" : "idle";
}

/** Sentry returns event counts as strings on some endpoints. */
function toCount(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The organization to report on: the configured slug, else the first one the
 * token can see. Most Sentry tokens are scoped to a single organization.
 */
async function resolveOrganization(
  token: string,
  configured?: string,
): Promise<SentryOrganization> {
  if (configured) return { slug: configured };

  const organizations =
    await sentryFetch<SentryOrganization[]>(token, "/organizations/");
  const first = organizations[0];
  if (!first) throw new Error("This Sentry token cannot see any organization");
  return first;
}

export const sentryConnector: Connector = {
  provider: "sentry",
  async test(credentials: ConnectionCredentials): Promise<TestResult> {
    const token = credentials.apiKey?.trim();
    if (!token) return { ok: false, message: "API token is required" };

    try {
      const organization = await resolveOrganization(
        token,
        credentials.orgSlug?.trim(),
      );
      return {
        ok: true,
        message: `Connected to ${organization.name || organization.slug}`,
      };
    } catch (error) {
      return { ok: false, message: toUserFacingError(error, "sentry") };
    }
  },
};

export async function fetchSentryDashboard(
  credentials: ConnectionCredentials,
): Promise<SentryDashboard> {
  const token = credentials.apiKey?.trim();
  if (!token) throw new Error("Sentry API token is required");

  const organization = await resolveOrganization(
    token,
    credentials.orgSlug?.trim(),
  );

  const [issues, projects] = await Promise.all([
    sentryFetch<SentryIssue[]>(
      token,
      `/organizations/${organization.slug}/issues/?query=${encodeURIComponent(
        "is:unresolved",
      )}&statsPeriod=24h&limit=${ISSUE_LIMIT}`,
    ),
    sentryFetch<SentryProject[]>(
      token,
      `/organizations/${organization.slug}/projects/`,
    ).catch((error: unknown) => {
      // Issues need `event:read`, projects `project:read`; a token with only
      // the first still gets its issue list.
      log.debug("projects unavailable", {
        organization: organization.slug,
        reason: describeError(error),
      });
      return [] as SentryProject[];
    }),
  ]);

  const items: SentryIssueItem[] = issues.map((issue) => ({
    id: issue.id,
    title: issue.title,
    culprit: issue.culprit,
    level: issue.level || "error",
    status: levelStatus(issue.level),
    count: toCount(issue.count),
    userCount: issue.userCount ?? 0,
    lastSeen: issue.lastSeen || new Date().toISOString(),
    projectName: issue.project?.name || issue.project?.slug,
    permalink: issue.permalink,
  }));

  return {
    organizationName: organization.name || organization.slug,
    unresolved: items.length,
    events24h: items.reduce((sum, issue) => sum + issue.count, 0),
    issues: items,
    projects: projects.slice(0, PROJECT_LIMIT).map(
      (project): StatusItem => ({
        id: project.id,
        name: project.name || project.slug,
        provider: "sentry",
        status: projectStatus(project),
        detail: project.firstEvent ? "Receiving events" : "No events yet",
      }),
    ),
    // The issue endpoint caps at ISSUE_LIMIT, so a full page means there are
    // very likely more than we are showing.
    truncated: issues.length >= ISSUE_LIMIT,
  };
}
