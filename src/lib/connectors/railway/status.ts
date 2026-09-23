import type { RailwayDeployHealth, TrackerPoint } from "../types";
import { friendlyStatusLabel } from "../errors";

/**
 * Railway's raw deployment statuses, and everything the dashboard reads off
 * them: tone, label, stage, and which role a deploy can play in the "how far
 * behind is live?" calculation.
 */

export type Tone = TrackerPoint["status"];
export type ActiveStatus = RailwayDeployHealth["active"]["status"];

type StatusSpec = {
  tone: Tone;
  label: string;
  stage: string;
  active: ActiveStatus;
  inFlight?: boolean;
  failed?: boolean;
  liveCandidate?: boolean;
};

/** Single source of truth: raw Railway deploy status → everything derived from it. */
const RAILWAY_STATUS: Record<string, StatusSpec> = {
  SUCCESS: { tone: "ok", label: "Running", stage: "Running", active: "healthy", liveCandidate: true },
  CRASHED: { tone: "error", label: "Crashed", stage: "Crashed at runtime", active: "crashed", liveCandidate: true },
  FAILED: { tone: "warn", label: "Failed", stage: "Failed to ship", active: "unknown", failed: true },
  BUILDING: { tone: "warn", label: "Building", stage: "Building", active: "unknown", inFlight: true },
  DEPLOYING: { tone: "warn", label: "Deploying", stage: "Deploying", active: "unknown", inFlight: true },
  INITIALIZING: { tone: "warn", label: "Starting", stage: "Starting", active: "unknown", inFlight: true },
  QUEUED: { tone: "warn", label: "Queued", stage: "Queued", active: "unknown", inFlight: true },
  WAITING: { tone: "warn", label: "Waiting", stage: "Waiting", active: "unknown", inFlight: true },
  NEEDS_APPROVAL: { tone: "warn", label: "Needs approval", stage: "Awaiting approval", active: "unknown", inFlight: true },
  SLEEPING: { tone: "idle", label: "Sleeping", stage: "Sleeping", active: "sleeping" },
  REMOVED: { tone: "idle", label: "Removed", stage: "Removed", active: "unknown" },
  REMOVING: { tone: "idle", label: "Removed", stage: "Removed", active: "unknown" },
  SKIPPED: { tone: "idle", label: "Skipped", stage: "Skipped", active: "unknown" },
};

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  error: "bg-destructive",
  idle: "bg-muted-foreground/30",
};

function statusSpec(raw?: string): StatusSpec | undefined {
  return raw ? RAILWAY_STATUS[raw.toUpperCase()] : undefined;
}

export function statusColor(status: string): Tone {
  return statusSpec(status)?.tone ?? "idle";
}

export function colorFor(status: Tone): string {
  return TONE_CLASS[status];
}

export function rawStatusLabel(raw: string): string {
  return statusSpec(raw)?.label ?? friendlyStatusLabel(statusColor(raw));
}

export function isHealthyService(status: Tone): boolean {
  return status === "ok";
}

function metaString(
  meta: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | undefined {
  if (!meta) return undefined;
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Commit label / hash / branch pulled from a deployment's `meta` blob. */
export function readDeployMeta(meta?: Record<string, unknown> | null): {
  label: string;
  commitHash?: string;
  branch?: string;
} {
  const hash = metaString(meta, "commitHash", "commitSha", "sha");
  const commitHash = hash ? hash.slice(0, 7) : undefined;
  const message = metaString(meta, "commitMessage", "message", "title");
  let label = "Deploy";
  if (message) {
    const oneLine = message.split("\n")[0].trim();
    label = oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine;
  } else if (commitHash) {
    label = commitHash;
  }
  return { label, commitHash, branch: metaString(meta, "branch", "branchName") };
}

/** Human stage from status, with a light meta hint for the FAILED reason. */
export function deployStage(
  rawStatus: string,
  meta?: Record<string, unknown> | null,
): string {
  const spec = statusSpec(rawStatus);
  if (spec?.failed) {
    const reason =
      metaString(meta, "reason", "error", "failureReason")?.toLowerCase() ?? "";
    if (reason.includes("build")) return "Build failed";
    if (reason.includes("health")) return "Healthcheck failed";
    if (reason.includes("deploy")) return "Deploy failed";
  }
  return spec?.stage ?? rawStatusLabel(rawStatus);
}

export const isInFlightStatus = (s: string) => statusSpec(s)?.inFlight === true;
export const isFailedAttemptStatus = (s: string) => statusSpec(s)?.failed === true;
export const isLiveCandidateStatus = (s: string) =>
  statusSpec(s)?.liveCandidate === true;

export function activeStatusFromRaw(raw?: string): ActiveStatus {
  return statusSpec(raw)?.active ?? "unknown";
}
