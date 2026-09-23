import type { Provider } from "@/lib/providers";

export type ConnectionCredentials = {
  apiKey?: string;
  login?: string;
  secretKey?: string;
  accessToken?: string;
  refreshToken?: string;
  orgSlug?: string;
};

export type TestResult = {
  ok: boolean;
  message: string;
  meta?: Record<string, unknown>;
};

export type TrackerPoint = {
  key?: string;
  color: string;
  tooltip: string;
  status: "ok" | "warn" | "error" | "idle";
};

export type StatusItem = {
  id: string;
  name: string;
  provider: Provider;
  status: "ok" | "warn" | "error" | "idle";
  detail: string;
  updatedAt?: string;
};

export type BalanceInfo = {
  currency: string;
  balance: number;
  accountName: string;
  authorizedBalance?: number;
  main?: boolean;
  sharePct?: number;
};

export type TransactionItem = {
  id: string;
  label: string;
  amount: number;
  currency: string;
  side: "credit" | "debit";
  settledAt: string;
  status?: "pending" | "completed" | "declined" | "reversed";
  accountName?: string;
};

export type CashflowPeriod = {
  currency: string;
  inflow: number;
  outflow: number;
  net: number;
  days: number;
  transactionCount: number;
};

export type LiquidityInfo = {
  currency: string;
  booked: number;
  available: number;
  pendingDelta: number;
  accountCount: number;
};

export type BalanceHistoryPoint = {
  date: string;
  label: string;
  balance: number;
};

export type BalanceHistory = {
  currency: string;
  days: number;
  points: BalanceHistoryPoint[];
  /** True when transaction pagination may have truncated the window. */
  incomplete: boolean;
};

export type QontoDashboard = {
  organizationName?: string;
  balances: BalanceInfo[];
  liquidity: LiquidityInfo;
  cashflow30d: CashflowPeriod;
  balanceHistory: BalanceHistory;
};

export type QontoTransactionsPage = {
  transactions: TransactionItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type RailwayDeployItem = {
  id: string;
  serviceId: string;
  serviceName: string;
  projectName: string;
  status: TrackerPoint["status"];
  rawStatus: string;
  createdAt: string;
  label?: string;
  commitHash?: string;
  branch?: string;
  stage?: string;
};

/** One failed/in-flight attempt sitting above the live deploy. */
export type RailwayDeployAttempt = {
  id: string;
  createdAt: string;
  rawStatus: string;
  /** Where it broke or currently is (Build, Deploy, Runtime, …). */
  stage: string;
  /** Commit message or short fallback label. */
  label: string;
  commitHash?: string;
  branch?: string;
};

/**
 * “How far behind is the live deploy?” — active health plus newer failed attempts.
 */
export type RailwayDeployHealth = {
  serviceId: string;
  serviceName: string;
  projectName: string;
  /** What’s currently serving traffic. */
  active: {
    status: "healthy" | "crashed" | "sleeping" | "unknown";
    createdAt?: string;
    label?: string;
    commitHash?: string;
    rawStatus?: string;
  };
  /** Failed deploys newer than the live one. */
  behindCount: number;
  failedSinceActive: RailwayDeployAttempt[];
  /** Newest in-progress deploy, if any. */
  inFlight: RailwayDeployAttempt | null;
};

export type RailwayFleetHealth = {
  healthy: number;
  total: number;
  crashed: number;
  sleeping: number;
  degraded: number;
};

export type RailwayResourceSnapshot = {
  cpuCores: number | null;
  memoryGb: number | null;
  sampledServices: number;
  label: string;
};

export type RailwayUsageItem = {
  measurement: string;
  label: string;
  value: number;
  display: string;
};

/** One project as a row: what it holds and whether any of it is broken. */
export type RailwayProjectSummary = {
  id: string;
  name: string;
  serviceCount: number;
  healthy: number;
  failed: number;
  status: TrackerPoint["status"];
  detail: string;
  updatedAt?: string;
};

export type RailwayMetricPoint = {
  ts: string;
  label: string;
  value: number;
};

/**
 * One measurement over time, for a project's production environment.
 *
 * Railway reports these per sample interval rather than cumulatively, so
 * `NETWORK_TX_GB` is egress *during* each bucket — a rate, not a running total.
 */
export type RailwayMetricSeries = {
  key: "cpu" | "memory" | "egress" | "disk";
  label: string;
  unit: string;
  points: RailwayMetricPoint[];
  latest: number | null;
  peak: number;
  average: number;
};

export type RailwayMetrics = {
  projectName: string;
  environmentName?: string;
  hours: number;
  series: RailwayMetricSeries[];
};

/**
 * Spend for the current cycle. Railway exposes this only through a workspace,
 * so a project-scoped token has none of it.
 */
export type RailwayBilling = {
  workspaceName: string;
  plan?: string;
  currency: string;
  /** Projected total for the cycle, in currency units. */
  estimatedBill: number | null;
  /** Usage charges accrued so far this cycle. */
  currentUsage: number | null;
  creditBalance: number | null;
  cycleStart?: string;
  cycleEnd?: string;
  nextInvoiceDate?: string;
};

export type RailwayDashboard = {
  items: StatusItem[];
  trackers: Record<string, TrackerPoint[]>;
  /** Worst / most relevant service for the Deploy Health card. */
  deployHealth: RailwayDeployHealth | null;
  fleet: RailwayFleetHealth;
  recentDeploys: RailwayDeployItem[];
  resources: RailwayResourceSnapshot;
  usage: RailwayUsageItem[];
  projects: RailwayProjectSummary[];
  /** Time series for the busiest project, or null when none reported. */
  metrics: RailwayMetrics | null;
  billing: RailwayBilling | null;
};

export type SupabaseServiceItem = {
  id: string;
  projectName: string;
  serviceName: string;
  status: TrackerPoint["status"];
  detail: string;
  healthy: boolean;
};

export type SupabaseTrafficBucket = {
  label: string;
  value: number;
  display: string;
};

export type SupabaseAdvisorsSummary = {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  projectCount: number;
  top?: Array<{ title: string; level: string; projectName: string }>;
};

/** One advisor finding, as a row rather than a bare count. */
export type SupabaseAdvisorIssue = {
  id: string;
  name: string;
  title: string;
  level: "ERROR" | "WARN" | "INFO";
  status: TrackerPoint["status"];
  kind: "security" | "performance";
  projectName: string;
  detail?: string;
};

export type SupabaseDashboard = {
  items: StatusItem[];
  healthy: number;
  total: number;
  services: SupabaseServiceItem[];
  traffic: SupabaseTrafficBucket[];
  requestVolume: {
    total: number;
    days: number;
    label: string;
  };
  advisors: SupabaseAdvisorsSummary;
  advisorIssues: SupabaseAdvisorIssue[];
};

export type NetlifyDeployItem = {
  id: string;
  siteId: string;
  siteName: string;
  status: TrackerPoint["status"];
  rawState: string;
  branch?: string;
  createdAt: string;
};

export type NetlifyBuildMinutes = {
  current: number;
  previous: number;
  deltaPct: number | null;
  active: number;
  enqueued: number;
  label: string;
};

export type NetlifyFormItem = {
  id: string;
  name: string;
  siteName: string;
  submissionCount: number;
};

export type NetlifyDashboard = {
  items: StatusItem[];
  trackers: Record<string, TrackerPoint[]>;
  healthy: number;
  total: number;
  recentDeploys: NetlifyDeployItem[];
  buildMinutes: NetlifyBuildMinutes | null;
  forms: NetlifyFormItem[];
  formSubmissionsTotal: number;
};

/**
 * The providers with a live connector: the ones a user can connect and the
 * sync worker schedules. `CONNECTORS` in `./index` holds one for each.
 */
export type SyncableProvider =
  | "railway"
  | "vercel"
  | "netlify"
  | "supabase"
  | "sentry"
  | "stripe"
  | "lemonsqueezy"
  | "resend"
  | "qonto";

/**
 * Everything the app needs from one data source, in one place.
 *
 * Adding a provider means writing one of these and registering it in
 * `CONNECTORS`; the connection test, the sync worker and the registry tests
 * all read from there rather than from a list of their own.
 */
export interface Connector<
  TDashboard = unknown,
  P extends Provider = Provider,
> {
  provider: P;
  /**
   * Check the credentials with the cheapest authenticated call. Never throws:
   * a failure comes back as `ok: false` with a user-facing message.
   */
  test(credentials: ConnectionCredentials): Promise<TestResult>;
  /**
   * The dashboard snapshot the sync worker stores and the widgets read.
   *
   * Throws when the snapshot as a whole cannot be built (bad token, provider
   * down); the worker records that through `toUserFacingError`. A failing
   * sub-request degrades its own section instead of throwing.
   */
  fetchDashboard(credentials: ConnectionCredentials): Promise<TDashboard>;
}

/* ─────────────────────────────── Stripe ─────────────────────────────────── */

export type MoneyPoint = {
  label: string;
  value: number;
  display: string;
};

export type RevenueSummary = {
  currency: string;
  /** Normalised monthly recurring revenue across active subscriptions. */
  mrr: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  /** True when pagination stopped before every subscription was counted. */
  truncated: boolean;
};

export type PaymentItem = {
  id: string;
  description: string;
  amount: number;
  currency: string;
  status: "succeeded" | "pending" | "failed" | "refunded";
  createdAt: string;
  customer?: string;
};

export type StripeDashboard = {
  revenue: RevenueSummary;
  /** Gross volume over the trailing 30 days. */
  volume30d: MoneyPoint;
  payments: PaymentItem[];
  balance: { currency: string; available: number; pending: number } | null;
};

/* ───────────────────────────── Lemon Squeezy ────────────────────────────── */

export type LemonSqueezyDashboard = {
  storeName?: string;
  revenue: RevenueSummary;
  /** Store revenue over the trailing 30 days, as Lemon Squeezy reports it. */
  revenue30d: MoneyPoint;
  orders: PaymentItem[];
};

/* ─────────────────────────────── Sentry ─────────────────────────────────── */

export type SentryIssueItem = {
  id: string;
  title: string;
  culprit?: string;
  level: string;
  status: TrackerPoint["status"];
  count: number;
  userCount: number;
  lastSeen: string;
  projectName?: string;
  permalink?: string;
};

export type SentryDashboard = {
  organizationName?: string;
  unresolved: number;
  /** Events across the trailing 24 hours, as reported per issue. */
  events24h: number;
  issues: SentryIssueItem[];
  projects: StatusItem[];
  /** True when the issue list was capped before the real total. */
  truncated: boolean;
};

/* ─────────────────────────────── Resend ─────────────────────────────────── */

export type ResendDomainItem = {
  id: string;
  name: string;
  status: TrackerPoint["status"];
  rawStatus: string;
  region?: string;
  createdAt?: string;
};

export type ResendEmailItem = {
  id: string;
  to: string;
  subject: string;
  /** Resend's `last_event`, verbatim. */
  status: string;
  tone: TrackerPoint["status"];
  sentAt: string;
};

export type ResendBroadcastItem = {
  id: string;
  name: string;
  status: string;
  tone: TrackerPoint["status"];
  /**
   * Resend has no `updated_at` on a broadcast, so this is the newest timestamp
   * it does report — whichever of sent / scheduled / created came last.
   */
  updatedAt: string;
};

export type ResendMetricPoint = {
  period: string;
  label: string;
  sent: number;
  delivered: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
};

export type ResendMetricTotals = {
  sent: number;
  delivered: number;
  opened: number;
  uniqueOpened: number;
  clicked: number;
  uniqueClicked: number;
  failed: number;
  bounced: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
};

/**
 * Where emails ended up, as slices that do not overlap.
 *
 * Resend's raw counts nest — a clicked email is also opened and delivered — so
 * a pie of them would sum past the number sent. Each email is counted once, at
 * the furthest step it reached.
 */
export type ResendOutcomeSlice = {
  id: string;
  name: string;
  value: number;
};

export type ResendMetrics = {
  days: number;
  points: ResendMetricPoint[];
  totals: ResendMetricTotals;
  outcomes: ResendOutcomeSlice[];
};

export type ResendDashboard = {
  domains: ResendDomainItem[];
  verified: number;
  total: number;
  emails: ResendEmailItem[];
  broadcasts: ResendBroadcastItem[];
  metrics: ResendMetrics | null;
  /**
   * Which endpoints this key could not reach. Resend scopes keys per endpoint
   * group, so a sending-only key still gets domains — every other section
   * degrades on its own rather than failing the dashboard whole.
   */
  emailsUnavailable: boolean;
  broadcastsUnavailable: boolean;
  metricsUnavailable: boolean;
};

/* ─────────────────────────────── Vercel ─────────────────────────────────── */

export type VercelDeployItem = {
  id: string;
  projectName: string;
  status: TrackerPoint["status"];
  rawState: string;
  target?: string;
  branch?: string;
  commitMessage?: string;
  createdAt: string;
  url?: string;
};

export type VercelDashboard = {
  items: StatusItem[];
  trackers: Record<string, TrackerPoint[]>;
  ready: number;
  total: number;
  recentDeploys: VercelDeployItem[];
};
