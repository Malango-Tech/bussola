import { env, type StripePriceVariable } from "@/lib/env";

/**
 * What each plan allows.
 *
 * Limits and features live here rather than in Stripe so the app can answer
 * "may this organization do X?" from its own database, with no network call in
 * the request path. Stripe stays the source of truth for *which* plan is
 * active; this file says what that plan means.
 */
export type PlanId = "trial" | "solo" | "team";

export type AlertChannel = "email" | "slack" | "discord";

export type PlanLimits = {
  /** Dashboards the organization may create. */
  dashboards: number;
  /** Widgets on a single dashboard. */
  widgetsPerDashboard: number;
  /**
   * Provider connections. Unlimited on every paid plan — connectors are the
   * reason to buy Bussola, so they are never the thing that is rationed.
   */
  connections: number;
  /** Members, including the owner. Extra team seats are billed per seat. */
  seats: number;
  /** How far back sampled history is kept. */
  historyDays: number;
};

export type PlanFeatures = {
  /** Read-only dashboard share links. */
  sharing: boolean;
  /** Share links without Bussola branding, for client reporting. */
  whiteLabelSharing: boolean;
  alertChannels: AlertChannel[];
  /** The MCP server over this organization's data. */
  mcp: boolean;
  /** Organization-wide MCP configuration rather than per-user. */
  teamMcpConfig: boolean;
};

export type Plan = {
  id: PlanId;
  name: string;
  /** Cents per month, for display. Null for plans that are not sold. */
  monthlyCents: number | null;
  yearlyCents: number | null;
  currency: "eur";
  limits: PlanLimits;
  features: PlanFeatures;
  /** Env vars holding the Stripe price ids, when the plan is purchasable. */
  prices?: {
    monthly: StripePriceVariable;
    yearly: StripePriceVariable;
    extraSeat?: StripePriceVariable;
  };
};

export const UNLIMITED = Number.POSITIVE_INFINITY;

/**
 * The state before anyone has paid.
 *
 * Deliberately usable but not liveable: enough to connect a source and see a
 * real dashboard, not enough to run a business on. Signing up should show the
 * product working, not a paywall.
 */
const TRIAL: Plan = {
  id: "trial",
  name: "Trial",
  monthlyCents: null,
  yearlyCents: null,
  currency: "eur",
  limits: {
    dashboards: 1,
    widgetsPerDashboard: 4,
    connections: UNLIMITED,
    seats: 1,
    historyDays: 7,
  },
  features: {
    sharing: false,
    whiteLabelSharing: false,
    alertChannels: [],
    mcp: false,
    teamMcpConfig: false,
  },
};

const SOLO: Plan = {
  id: "solo",
  name: "Solo",
  monthlyCents: 1200,
  yearlyCents: 10800,
  currency: "eur",
  limits: {
    dashboards: 5,
    widgetsPerDashboard: 8,
    connections: UNLIMITED,
    seats: 1,
    historyDays: 30,
  },
  features: {
    sharing: false,
    whiteLabelSharing: false,
    alertChannels: ["email"],
    mcp: true,
    teamMcpConfig: false,
  },
  prices: { monthly: "STRIPE_PRICE_SOLO_MONTHLY", yearly: "STRIPE_PRICE_SOLO_YEARLY" },
};

const TEAM: Plan = {
  id: "team",
  name: "Team",
  monthlyCents: 3900,
  yearlyCents: 38400,
  currency: "eur",
  limits: {
    dashboards: 20,
    widgetsPerDashboard: 12,
    connections: UNLIMITED,
    seats: 5,
    historyDays: 365,
  },
  features: {
    sharing: true,
    whiteLabelSharing: true,
    alertChannels: ["email", "slack", "discord"],
    mcp: true,
    teamMcpConfig: true,
  },
  prices: {
    monthly: "STRIPE_PRICE_TEAM_MONTHLY",
    yearly: "STRIPE_PRICE_TEAM_YEARLY",
    extraSeat: "STRIPE_PRICE_TEAM_SEAT",
  },
};

export const PLANS: Record<PlanId, Plan> = {
  trial: TRIAL,
  solo: SOLO,
  team: TEAM,
};

export const DEFAULT_PLAN: PlanId = "trial";

/** Cents per additional Team seat beyond the included five. */
export const EXTRA_SEAT_CENTS = 800;

/** Everything a self-hosted install may do: all of it. */
export const SELF_HOSTED_LIMITS: PlanLimits = {
  dashboards: UNLIMITED,
  widgetsPerDashboard: UNLIMITED,
  connections: UNLIMITED,
  seats: UNLIMITED,
  historyDays: UNLIMITED,
};

export const SELF_HOSTED_FEATURES: PlanFeatures = {
  sharing: true,
  whiteLabelSharing: true,
  alertChannels: ["email", "slack", "discord"],
  mcp: true,
  teamMcpConfig: true,
};

export type BillingInterval = "monthly" | "yearly";

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

/** The configured Stripe price for a plan and interval, if any. */
export function priceIdFor(
  plan: PlanId,
  interval: BillingInterval = "monthly",
): string | undefined {
  const envVar = PLANS[plan].prices?.[interval];
  return envVar ? env()[envVar] : undefined;
}

export function extraSeatPriceId(plan: PlanId): string | undefined {
  const envVar = PLANS[plan].prices?.extraSeat;
  return envVar ? env()[envVar] : undefined;
}

/**
 * Map a Stripe price back to our plan.
 *
 * An unrecognised price falls back to the trial rather than guessing, so a
 * mis-configured price id can never quietly grant Team limits.
 */
export function planForPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return DEFAULT_PLAN;
  const config = env();
  for (const plan of Object.values(PLANS)) {
    if (!plan.prices) continue;
    for (const interval of ["monthly", "yearly"] as const) {
      if (config[plan.prices[interval]] === priceId) return plan.id;
    }
  }
  return DEFAULT_PLAN;
}

/** Plans a customer can actually buy right now, in display order. */
export function purchasablePlans(): Plan[] {
  return [SOLO, TEAM].filter(
    (plan) => priceIdFor(plan.id, "monthly") || priceIdFor(plan.id, "yearly"),
  );
}
