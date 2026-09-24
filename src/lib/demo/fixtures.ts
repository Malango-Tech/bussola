import type {
  RailwayDashboard,
  ResendDashboard,
  SupabaseDashboard,
} from "@/lib/connectors/types";
import type { Provider } from "@/lib/providers";

/**
 * Sample payloads shaped exactly like the real connector dashboards.
 *
 * A brand-new account has nothing connected, and a grid of empty widgets makes
 * a product look broken rather than new. These render the same components with
 * plausible numbers, so the first thing someone sees is Bussola working —
 * always labelled, never mistakable for their own data.
 *
 * The numbers are deliberately modest and internally consistent: a solo SaaS
 * with a few services and a few hundred euros of MRR, which is who this is for.
 */

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const hoursAgo = (h: number) => minutesAgo(h * 60);
const daysAgo = (d: number) => hoursAgo(d * 24);

const trail = (statuses: Array<"ok" | "warn" | "error" | "idle">) =>
  statuses.map((status, index) => ({
    key: `demo-${index}`,
    status,
    color:
      status === "ok"
        ? "bg-success"
        : status === "warn"
          ? "bg-warning"
          : status === "error"
            ? "bg-destructive"
            : "bg-muted-foreground/30",
    tooltip: `${status === "ok" ? "Deployed" : status} · ${new Date(
      now - (24 - index) * 3_600_000,
    ).toLocaleString()}`,
  }));

const OK_TRAIL = trail([
  "ok", "ok", "ok", "ok", "warn", "ok", "ok", "ok", "ok", "ok", "ok", "ok",
]);

/** A gently varying 24h trail at 15-minute resolution, for the usage charts. */
const demoSeries = (base: number, swing: number) =>
  Array.from({ length: 96 }, (_, index) => {
    const at = new Date(now - (95 - index) * 900_000);
    return {
      ts: at.toISOString(),
      label: at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      value: Number(
        (base + swing * (0.5 + 0.5 * Math.sin(index / 7)) * (index % 11 === 0 ? 1.4 : 1)).toFixed(4),
      ),
    };
  });

const railway = {
  items: [
    { id: "d1", name: "api", provider: "railway", status: "ok", detail: "Running", updatedAt: minutesAgo(18) },
    { id: "d2", name: "worker", provider: "railway", status: "ok", detail: "Running", updatedAt: hoursAgo(5) },
    { id: "d3", name: "web", provider: "railway", status: "warn", detail: "Deploying", updatedAt: minutesAgo(3) },
  ],
  trackers: { api: OK_TRAIL, worker: OK_TRAIL },
  deployHealth: {
    serviceId: "d1",
    serviceName: "api",
    projectName: "bussola",
    active: {
      status: "healthy",
      createdAt: minutesAgo(18),
      label: "fix: retry qonto pagination",
      commitHash: "a3f9c21",
      rawStatus: "SUCCESS",
    },
    behindCount: 1,
    failedSinceActive: [
      {
        id: "att1",
        createdAt: minutesAgo(6),
        rawStatus: "FAILED",
        stage: "Build failed",
        label: "chore: bump deps",
        commitHash: "b71d004",
        branch: "main",
      },
    ],
    inFlight: null,
  },
  fleet: { healthy: 2, total: 3, crashed: 0, sleeping: 0, degraded: 1 },
  recentDeploys: [
    { id: "r1", serviceId: "d1", serviceName: "api", projectName: "bussola", status: "ok", rawStatus: "SUCCESS", createdAt: minutesAgo(18), label: "fix: retry qonto pagination", commitHash: "a3f9c21", branch: "main" },
    { id: "r2", serviceId: "d3", serviceName: "web", projectName: "bussola", status: "warn", rawStatus: "BUILDING", createdAt: minutesAgo(3), label: "feat: demo mode", commitHash: "c02fe18", branch: "main" },
    { id: "r3", serviceId: "d2", serviceName: "worker", projectName: "bussola", status: "ok", rawStatus: "SUCCESS", createdAt: hoursAgo(5), label: "perf: batch sync claims", commitHash: "9e4ab77", branch: "main" },
  ],
  resources: { cpuCores: 0.42, memoryGb: 1.18, sampledServices: 3, label: "Last hour" },
  projects: [
    { id: "p1", name: "bussola", serviceCount: 3, healthy: 2, failed: 1, status: "error", detail: "3 services · 1 failing", updatedAt: minutesAgo(3) },
    { id: "p2", name: "landing", serviceCount: 1, healthy: 1, failed: 0, status: "ok", detail: "1 service", updatedAt: hoursAgo(30) },
  ],
  metrics: {
    projectName: "bussola",
    environmentName: "production",
    hours: 24,
    series: [
      { key: "cpu", label: "CPU", unit: "vCPU", latest: 0.31, peak: 0.68, average: 0.34, points: demoSeries(0.3, 0.38) },
      { key: "memory", label: "Memory", unit: "GB", latest: 1.21, peak: 1.44, average: 1.18, points: demoSeries(1.15, 0.3) },
      { key: "egress", label: "Egress", unit: "GB", latest: 0.004, peak: 0.012, average: 0.005, points: demoSeries(0.004, 0.008) },
      { key: "disk", label: "Disk", unit: "GB", latest: 2.4, peak: 2.4, average: 2.38, points: demoSeries(2.35, 0.06) },
    ],
  },
  billing: {
    workspaceName: "Malango Tech UG",
    plan: "HOBBY",
    currency: "usd",
    estimatedBill: 42.18,
    currentUsage: 27.4,
    creditBalance: 0,
    cycleStart: daysAgo(18),
    cycleEnd: hoursAgo(-288),
    nextInvoiceDate: hoursAgo(-288),
  },
  usage: [
    { measurement: "CPU", label: "CPU", value: 3.4, display: "3.4 vCPU-h" },
    { measurement: "MEMORY", label: "Memory", value: 8.1, display: "8.1 GB-h" },
    { measurement: "EGRESS", label: "Egress", value: 2.2, display: "2.2 GB" },
  ],
} satisfies RailwayDashboard;

const vercel = {
  items: [
    { id: "v1", name: "marketing", provider: "vercel", status: "ok", detail: "Ready", updatedAt: hoursAgo(2) },
    { id: "v2", name: "docs", provider: "vercel", status: "ok", detail: "Ready", updatedAt: daysAgo(1) },
  ],
  trackers: { marketing: OK_TRAIL, docs: OK_TRAIL },
  ready: 2,
  total: 2,
  recentDeploys: [
    { id: "vd1", projectName: "marketing", status: "ok", rawState: "Ready", target: "production", branch: "main", commitMessage: "copy: pricing page", createdAt: hoursAgo(2), url: "marketing.vercel.app" },
    { id: "vd2", projectName: "docs", status: "ok", rawState: "Ready", target: "production", branch: "main", commitMessage: "docs: connector setup", createdAt: daysAgo(1) },
  ],
};

const netlify = {
  items: [
    { id: "n1", name: "landing", provider: "netlify", status: "ok", detail: "Published", updatedAt: hoursAgo(9) },
  ],
  // Keyed by site id, as the connector keys them.
  trackers: { n1: OK_TRAIL },
  healthy: 1,
  total: 1,
  recentDeploys: [
    { id: "nd1", siteId: "n1", siteName: "landing", status: "ok", rawState: "ready", branch: "main", createdAt: hoursAgo(9) },
  ],
  buildMinutes: { current: 42, previous: 51, deltaPct: -17.6, active: 0, enqueued: 0, label: "This period" },
  forms: [{ id: "f1", name: "waitlist", siteName: "landing", submissionCount: 37 }],
  formSubmissionsTotal: 37,
};

const supabase = {
  items: [
    { id: "s1", name: "bussola-prod", provider: "supabase", status: "ok", detail: "Healthy", updatedAt: minutesAgo(30) },
  ],
  healthy: 1,
  total: 1,
  services: [
    { id: "db", projectName: "bussola-prod", serviceName: "Database", status: "ok", detail: "Healthy", healthy: true },
    { id: "auth", projectName: "bussola-prod", serviceName: "Auth", status: "ok", detail: "Healthy", healthy: true },
    { id: "storage", projectName: "bussola-prod", serviceName: "Storage", status: "ok", detail: "Healthy", healthy: true },
    { id: "realtime", projectName: "bussola-prod", serviceName: "Realtime", status: "ok", detail: "Healthy", healthy: true },
    { id: "rest", projectName: "bussola-prod", serviceName: "PostgREST", status: "ok", detail: "ACTIVE_HEALTHY", healthy: true },
    { id: "functions", projectName: "bussola-prod", serviceName: "Edge Functions", status: "ok", detail: "4 deployed", healthy: true },
  ],
  traffic: [
    { label: "PostgREST", value: 18400, display: "18.4k" },
    { label: "Auth", value: 5200, display: "5.2k" },
    { label: "Storage", value: 890, display: "890" },
    { label: "Realtime", value: 320, display: "320" },
  ],
  requestVolume: { total: 24810, days: 7, label: "Last 7 days" },
  advisors: {
    total: 2,
    errors: 0,
    warnings: 2,
    infos: 0,
    projectCount: 1,
    top: [
      { title: "RLS disabled on public.waitlist", level: "WARN", projectName: "bussola-prod" },
      { title: "Function search_path is mutable", level: "WARN", projectName: "bussola-prod" },
    ],
  },
  advisorIssues: [
    { id: "a1", name: "rls_disabled_in_public", title: "RLS disabled on public.waitlist", level: "WARN", status: "warn", kind: "security", projectName: "bussola-prod", detail: "Row level security is not enabled on this table." },
    { id: "a2", name: "function_search_path_mutable", title: "Function search_path is mutable", level: "WARN", status: "warn", kind: "security", projectName: "bussola-prod" },
    { id: "a3", name: "unindexed_foreign_keys", title: "Unindexed foreign key on orders.customer_id", level: "INFO", status: "idle", kind: "performance", projectName: "bussola-prod" },
  ],
} satisfies SupabaseDashboard;

const sentry = {
  organizationName: "bussola",
  unresolved: 3,
  events24h: 47,
  issues: [
    { id: "i1", title: "TypeError: Cannot read properties of undefined", culprit: "widget-renderer", level: "error", status: "error", count: 31, userCount: 4, lastSeen: minutesAgo(22), projectName: "web" },
    { id: "i2", title: "TimeoutError: Railway API timed out after 10000ms", culprit: "connectors/railway", level: "warning", status: "warn", count: 12, userCount: 2, lastSeen: hoursAgo(3), projectName: "worker" },
    { id: "i3", title: "AbortError: signal is aborted without reason", culprit: "sync/runner", level: "warning", status: "warn", count: 4, userCount: 1, lastSeen: hoursAgo(11), projectName: "worker" },
  ],
  projects: [
    { id: "p1", name: "web", provider: "sentry", status: "ok", detail: "Receiving events" },
    { id: "p2", name: "worker", provider: "sentry", status: "ok", detail: "Receiving events" },
  ],
  truncated: false,
};

const stripe = {
  revenue: { currency: "eur", mrr: 1284, activeSubscriptions: 96, trialingSubscriptions: 7, truncated: false },
  volume30d: { label: "Last 30 days", value: 1462.5, display: "108 payments" },
  payments: [
    { id: "ch1", description: "Bussola Solo", amount: 12, currency: "eur", status: "succeeded", createdAt: hoursAgo(1), customer: "ana@example.com" },
    { id: "ch2", description: "Bussola Team", amount: 39, currency: "eur", status: "succeeded", createdAt: hoursAgo(4), customer: "ops@example.com" },
    { id: "ch3", description: "Bussola Solo", amount: 12, currency: "eur", status: "failed", createdAt: hoursAgo(9), customer: "leo@example.com" },
    { id: "ch4", description: "Bussola Solo (annual)", amount: 108, currency: "eur", status: "succeeded", createdAt: daysAgo(1), customer: "kim@example.com" },
  ],
  balance: { currency: "eur", available: 3120.44, pending: 286.1 },
};

const lemonsqueezy = {
  storeName: "Bussola",
  revenue: { currency: "usd", mrr: 412, activeSubscriptions: 28, trialingSubscriptions: 3, truncated: false },
  revenue30d: { label: "Last 30 days", value: 508.0, display: "24 orders" },
  orders: [
    { id: "o1", description: "Bussola Solo", amount: 12, currency: "usd", status: "succeeded", createdAt: hoursAgo(2), customer: "sam@example.com" },
    { id: "o2", description: "Bussola Team", amount: 39, currency: "usd", status: "succeeded", createdAt: hoursAgo(20), customer: "team@example.com" },
    { id: "o3", description: "Bussola Solo", amount: 12, currency: "usd", status: "refunded", createdAt: daysAgo(2), customer: "rey@example.com" },
  ],
};

/** Fourteen days of sending, busiest midweek, with one bounced batch. */
const resendMetricPoints = Array.from({ length: 14 }, (_, index) => {
  const day = new Date(now - (13 - index) * 86_400_000);
  const weekday = day.getUTCDay();
  const sent = weekday === 0 || weekday === 6 ? 3 + (index % 2) : 9 + (index % 5);
  const delivered = index === 9 ? sent - 1 : sent;
  return {
    period: day.toISOString().slice(0, 10),
    label: day.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    sent,
    delivered,
    deliveryRate: Math.round((delivered / sent) * 1000) / 10,
    openRate: 48 + ((index * 7) % 22),
    clickRate: 4 + ((index * 3) % 7),
  };
});

const resendTotals = resendMetricPoints.reduce(
  (acc, point) => ({
    sent: acc.sent + point.sent,
    delivered: acc.delivered + point.delivered,
  }),
  { sent: 0, delivered: 0 },
);

const resend = {
  domains: [
    { id: "rd1", name: "usebussola.com", status: "ok", rawStatus: "verified", region: "eu-west-1", createdAt: daysAgo(40) },
    { id: "rd2", name: "mail.usebussola.com", status: "warn", rawStatus: "pending", region: "eu-west-1", createdAt: daysAgo(2) },
  ],
  verified: 1,
  total: 2,
  emails: [
    { id: "e1", to: "ana@example.com", subject: "Your Bussola receipt", status: "delivered", tone: "ok", sentAt: hoursAgo(1) },
    { id: "e2", to: "leo@example.com", subject: "Payment failed — update your card", status: "clicked", tone: "ok", sentAt: hoursAgo(9) },
    { id: "e3", to: "kim@example.com", subject: "Welcome to Bussola", status: "opened", tone: "ok", sentAt: daysAgo(1) },
    { id: "e4", to: "sam@example.com", subject: "Your weekly digest", status: "bounced", tone: "error", sentAt: daysAgo(2) },
    { id: "e5", to: "noa@example.com", subject: "Your trial ends in 3 days", status: "queued", tone: "idle", sentAt: daysAgo(3) },
  ],
  broadcasts: [
    { id: "rb1", name: "Product update — March", status: "sent", tone: "ok", updatedAt: daysAgo(4) },
    { id: "rb2", name: "Changelog #12", status: "scheduled", tone: "warn", updatedAt: daysAgo(1) },
    { id: "rb3", name: "Beta announcement", status: "draft", tone: "idle", updatedAt: daysAgo(11) },
  ],
  metrics: {
    days: 14,
    points: resendMetricPoints,
    totals: {
      sent: resendTotals.sent,
      delivered: resendTotals.delivered,
      opened: 132,
      uniqueOpened: 61,
      clicked: 14,
      uniqueClicked: 9,
      failed: 0,
      bounced: resendTotals.sent - resendTotals.delivered,
      deliveryRate: Math.round((resendTotals.delivered / resendTotals.sent) * 1000) / 10,
      openRate: 58.4,
      clickRate: 6.2,
    },
    outcomes: [
      { id: "clicked", name: "Clicked", value: 9 },
      { id: "opened", name: "Opened", value: 52 },
      { id: "delivered", name: "Delivered", value: resendTotals.delivered - 61 },
      { id: "failed", name: "Failed", value: resendTotals.sent - resendTotals.delivered },
    ],
  },
  emailsUnavailable: false,
  broadcastsUnavailable: false,
  metricsUnavailable: false,
  // Pinned to the real shape, so a connector change that the widgets follow
  // cannot leave the demo rendering fields nothing produces any more.
} satisfies ResendDashboard;

const qonto = {
  organizationName: "Malango Tech UG",
  balances: [
    { currency: "EUR", balance: 18420.55, accountName: "Main account", authorizedBalance: 18134.45, main: true, sharePct: 78 },
    { currency: "EUR", balance: 5210.0, accountName: "Tax reserve", authorizedBalance: 5210.0, main: false, sharePct: 22 },
  ],
  liquidity: { currency: "EUR", booked: 23630.55, available: 23344.45, pendingDelta: -286.1, accountCount: 2 },
  cashflow30d: { currency: "EUR", inflow: 4180.25, outflow: 2934.7, net: 1245.55, days: 30, transactionCount: 63 },
  balanceHistory: {
    currency: "EUR",
    days: 30,
    incomplete: false,
    points: Array.from({ length: 30 }, (_, index) => {
      const day = new Date(now - (29 - index) * 86_400_000);
      return {
        date: day.toISOString(),
        label: day.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        // A gently rising balance with a mid-month dip for payroll.
        balance: 17200 + index * 48 - (index > 14 && index < 19 ? 1900 : 0),
      };
    }),
  },
};

const qontoTransactions = {
  transactions: [
    { id: "t1", label: "Stripe payout", amount: 1462.5, currency: "EUR", side: "credit", settledAt: hoursAgo(6), status: "completed", accountName: "Main account" },
    { id: "t2", label: "Railway", amount: 42.18, currency: "EUR", side: "debit", settledAt: daysAgo(1), status: "completed", accountName: "Main account" },
    { id: "t3", label: "Supabase", amount: 25.0, currency: "EUR", side: "debit", settledAt: daysAgo(2), status: "completed", accountName: "Main account" },
    { id: "t4", label: "Customer invoice #2026-041", amount: 890.0, currency: "EUR", side: "credit", settledAt: daysAgo(3), status: "completed", accountName: "Main account" },
    { id: "t5", label: "Resend", amount: 18.0, currency: "EUR", side: "debit", settledAt: daysAgo(4), status: "pending", accountName: "Main account" },
  ],
  nextCursor: null,
  hasMore: false,
};

const DASHBOARDS: Partial<Record<Provider, Record<string, unknown>>> = {
  railway,
  vercel,
  netlify,
  supabase,
  sentry,
  stripe,
  lemonsqueezy,
  resend,
  qonto,
};

/** Demo payload for a provider's dashboard, or null if there is none. */
export function demoDashboard(provider: Provider): Record<string, unknown> | null {
  return DASHBOARDS[provider] ?? null;
}

export function demoTransactions(): Record<string, unknown> {
  return qontoTransactions;
}

/** The cross-source status board, assembled from the same fixtures. */
export function demoStatusBoard(): Record<string, unknown> {
  return {
    items: [
      ...railway.items,
      ...vercel.items,
      ...netlify.items,
      ...supabase.items,
    ],
  };
}
