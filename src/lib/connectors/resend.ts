import type {
  ConnectionCredentials,
  Connector,
  ResendBroadcastItem,
  ResendDashboard,
  ResendDomainItem,
  ResendEmailItem,
  ResendMetricPoint,
  ResendMetrics,
  ResendMetricTotals,
  ResendOutcomeSlice,
  TestResult,
  TrackerPoint,
} from "./types";
import { toUserFacingError } from "./errors";
import { fetchJson } from "./http";
import { daysAgo } from "./shared/dates";

const BASE = "https://api.resend.com";
const RECENT_EMAILS = 25;
const RECENT_BROADCASTS = 25;
/** Two weeks reads as a trend without making the daily columns unreadable. */
const METRIC_DAYS = 14;

async function resendFetch<T>(key: string, path: string): Promise<T> {
  return fetchJson<T>(
    `${BASE}${path}`,
    { headers: { Authorization: `Bearer ${key}` } },
    { label: "Resend" },
  );
}

/**
 * Run a section that the key may not be scoped for.
 *
 * Resend issues keys per endpoint group, so a send-only key 403s on `/emails`
 * while `/domains` still answers. Each section reports its own availability and
 * the dashboard renders what it got.
 */
async function optional<T>(
  section: string,
  load: () => Promise<T>,
): Promise<{ value: T | null; unavailable: boolean }> {
  try {
    return { value: await load(), unavailable: false };
  } catch (error) {
    // A section going quiet is a permissions or upstream problem worth being
    // able to read back; the widget only ever says "unavailable".
    console.warn(
      `[resend] ${section} unavailable:`,
      error instanceof Error ? error.message : error,
    );
    return { value: null, unavailable: true };
  }
}

type ResendDomain = {
  id: string;
  name: string;
  status?: string;
  region?: string;
  created_at?: string;
};

type ResendEmail = {
  id: string;
  to?: string[] | string;
  subject?: string;
  last_event?: string;
  created_at?: string;
};

type ResendBroadcast = {
  id: string;
  name?: string;
  status?: string;
  created_at?: string;
  scheduled_at?: string | null;
  sent_at?: string | null;
};

type ResendMetricRow = Record<string, number | string | null | undefined> & {
  period?: string;
};

type ResendMetricsResponse = {
  totals?: Record<string, number>;
  data?: ResendMetricRow[];
};

/**
 * A domain that is not verified cannot send, so it is the one thing worth
 * surfacing loudly — "verified" is the whole point of the widget.
 */
export function domainStatus(status?: string): TrackerPoint["status"] {
  switch (status) {
    case "verified":
      return "ok";
    case "pending":
    case "partially_verified":
    case "temporary_failure":
      return "warn";
    case "failed":
    case "partially_failed":
    case "not_started":
      return "error";
    default:
      return "idle";
  }
}

export function domainStatusLabel(status?: string): string {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ");
}

/**
 * How a `last_event` should read as a badge.
 *
 * Engagement outrank delivery — an opened email is a better outcome than a
 * merely delivered one — and anything still in flight stays neutral so the
 * table's colour is only ever about a settled result.
 */
export function emailStatusTone(event?: string): TrackerPoint["status"] {
  switch (event) {
    case "delivered":
    case "opened":
    case "clicked":
      return "ok";
    case "delivery_delayed":
    case "complained":
    case "suppressed":
    case "canceled":
      return "warn";
    case "bounced":
    case "failed":
      return "error";
    default:
      // queued, scheduled, sent — sent but not yet resolved.
      return "idle";
  }
}

export function broadcastStatusTone(status?: string): TrackerPoint["status"] {
  switch (status) {
    case "sent":
      return "ok";
    case "scheduled":
    case "queued":
      return "warn";
    case "canceled":
      return "error";
    default:
      // draft
      return "idle";
  }
}

function recipient(to: ResendEmail["to"]): string {
  if (Array.isArray(to)) return to[0] ?? "—";
  return to || "—";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isoDaysAgo(days: number): string {
  return daysAgo(days).toISOString().slice(0, 10);
}

function dayLabel(period: string): string {
  const date = new Date(period);
  if (Number.isNaN(date.getTime())) return period;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Split the period into slices that sum to what was sent.
 *
 * Resend's counts nest, so each email is attributed to the furthest step it
 * reached: clicked wins over opened, opened over delivered. Unique counts are
 * what make that possible — `opened` counts every open, including repeats.
 */
export function outcomeSlices(totals: ResendMetricTotals): ResendOutcomeSlice[] {
  const clicked = totals.uniqueClicked;
  const opened = Math.max(totals.uniqueOpened - clicked, 0);
  const delivered = Math.max(totals.delivered - totals.uniqueOpened, 0);
  const failed = totals.failed + totals.bounced;

  return [
    { id: "clicked", name: "Clicked", value: clicked },
    { id: "opened", name: "Opened", value: opened },
    { id: "delivered", name: "Delivered", value: delivered },
    { id: "failed", name: "Failed", value: failed },
  ];
}

function toTotals(totals: Record<string, number>): ResendMetricTotals {
  return {
    sent: num(totals.sent),
    delivered: num(totals.delivered),
    opened: num(totals.opened),
    uniqueOpened: num(totals.unique_opened),
    clicked: num(totals.clicked),
    uniqueClicked: num(totals.unique_clicked),
    failed: num(totals.failed),
    bounced: num(totals.bounced),
    deliveryRate: num(totals.delivery_rate),
    openRate: num(totals.open_rate),
    clickRate: num(totals.click_rate),
  };
}

const METRIC_FIELDS = [
  "sent",
  "delivered",
  "opened",
  "unique_opened",
  "clicked",
  "unique_clicked",
  "bounced",
  "failed",
  "delivery_rate",
  "open_rate",
  "click_rate",
].join(",");

async function fetchMetrics(key: string): Promise<ResendMetrics> {
  const query = new URLSearchParams({
    start_date: isoDaysAgo(METRIC_DAYS - 1),
    end_date: isoDaysAgo(0),
    granularity: "daily",
    dimensions: "period",
    metrics: METRIC_FIELDS,
  });

  const response = await resendFetch<ResendMetricsResponse>(
    key,
    `/emails/metrics?${query}`,
  );

  const points: ResendMetricPoint[] = (response.data ?? [])
    .filter((row) => typeof row.period === "string")
    .map((row) => ({
      period: row.period as string,
      label: dayLabel(row.period as string),
      sent: num(row.sent),
      delivered: num(row.delivered),
      deliveryRate: num(row.delivery_rate),
      openRate: num(row.open_rate),
      clickRate: num(row.click_rate),
    }));

  const totals = toTotals(response.totals ?? {});

  return {
    days: METRIC_DAYS,
    points,
    totals,
    outcomes: outcomeSlices(totals),
  };
}

async function fetchBroadcasts(key: string): Promise<ResendBroadcastItem[]> {
  const response = await resendFetch<{ data?: ResendBroadcast[] }>(
    key,
    `/broadcasts?limit=${RECENT_BROADCASTS}`,
  );

  return (response.data ?? [])
    .map((broadcast) => ({
      id: broadcast.id,
      name: broadcast.name?.trim() || "Untitled",
      status: broadcast.status || "draft",
      tone: broadcastStatusTone(broadcast.status),
      updatedAt:
        broadcast.sent_at ||
        broadcast.scheduled_at ||
        broadcast.created_at ||
        "",
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function fetchEmails(key: string): Promise<ResendEmailItem[]> {
  const response = await resendFetch<{ data?: ResendEmail[] }>(
    key,
    `/emails?limit=${RECENT_EMAILS}`,
  );

  return (response.data ?? []).map((email) => ({
    id: email.id,
    to: recipient(email.to),
    subject: email.subject || "(no subject)",
    status: email.last_event || "sent",
    tone: emailStatusTone(email.last_event),
    // Resend reports no send time; `created_at` is when the send was accepted.
    sentAt: email.created_at || new Date().toISOString(),
  }));
}

export const resendConnector: Connector = {
  provider: "resend",
  async test(credentials: ConnectionCredentials): Promise<TestResult> {
    const key = credentials.apiKey?.trim();
    if (!key) return { ok: false, message: "API key is required" };

    try {
      const domains = await resendFetch<{ data?: ResendDomain[] }>(
        key,
        "/domains",
      );
      const count = domains.data?.length ?? 0;
      return {
        ok: true,
        message:
          count > 0
            ? `Connected to Resend (${count} domain${count === 1 ? "" : "s"})`
            : "Connected to Resend — no domains yet",
      };
    } catch (error) {
      return { ok: false, message: toUserFacingError(error, "resend") };
    }
  },
};

export async function fetchResendDashboard(
  credentials: ConnectionCredentials,
): Promise<ResendDashboard> {
  const key = credentials.apiKey?.trim();
  if (!key) throw new Error("Resend API key is required");

  const domainsResponse = await resendFetch<{ data?: ResendDomain[] }>(
    key,
    "/domains",
  );

  const [emails, broadcasts, metrics] = await Promise.all([
    optional("emails", () => fetchEmails(key)),
    optional("broadcasts", () => fetchBroadcasts(key)),
    optional("metrics", () => fetchMetrics(key)),
  ]);

  const domains: ResendDomainItem[] = (domainsResponse.data ?? []).map(
    (domain) => ({
      id: domain.id,
      name: domain.name,
      status: domainStatus(domain.status),
      rawStatus: domainStatusLabel(domain.status),
      region: domain.region,
      createdAt: domain.created_at,
    }),
  );

  return {
    domains,
    verified: domains.filter((domain) => domain.status === "ok").length,
    total: domains.length,
    emails: emails.value ?? [],
    broadcasts: broadcasts.value ?? [],
    metrics: metrics.value,
    emailsUnavailable: emails.unavailable,
    broadcastsUnavailable: broadcasts.unavailable,
    metricsUnavailable: metrics.unavailable,
  };
}
