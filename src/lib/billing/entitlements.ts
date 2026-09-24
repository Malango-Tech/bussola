import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { isCloud } from "@/lib/edition";
import {
  DEFAULT_PLAN,
  PLANS,
  SELF_HOSTED_FEATURES,
  SELF_HOSTED_LIMITS,
  type AlertChannel,
  type PlanFeatures,
  type PlanId,
  type PlanLimits,
} from "./plans";

/**
 * Stripe statuses that still entitle a customer to their paid plan.
 *
 * `past_due` is deliberately included: a failed renewal should trigger dunning,
 * not lock someone out of their dashboards while their card is being retried.
 */
const ENTITLING_STATUSES = new Set(["active", "trialing", "past_due"]);

export type Entitlements = {
  plan: PlanId;
  planName: string;
  limits: PlanLimits;
  features: PlanFeatures;
  status: string;
  /** True while a paid plan is in a state that still grants access. */
  active: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  /** Seats paid for beyond the plan's included allowance. */
  extraSeats: number;
};

const SELF_HOSTED: Entitlements = {
  plan: "team",
  planName: "Self-hosted",
  limits: SELF_HOSTED_LIMITS,
  features: SELF_HOSTED_FEATURES,
  status: "self_hosted",
  active: true,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  extraSeats: 0,
};

export type SubscriptionRow = {
  plan: PlanId;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  extraSeats: number;
};

/**
 * Turn a stored subscription into entitlements.
 *
 * Split out from the database read so every branch — no row, a lapsed one, a
 * plan id we no longer recognise — is directly testable. Anything that is not
 * an entitling status falls back to the trial rather than the plan named on
 * the row, so a cancelled Team subscription does not keep Team limits.
 */
export function entitlementsFromRow(row: SubscriptionRow | null): Entitlements {
  const fallback = PLANS[DEFAULT_PLAN];

  if (!row || !ENTITLING_STATUSES.has(row.status)) {
    return {
      plan: fallback.id,
      planName: fallback.name,
      limits: fallback.limits,
      features: fallback.features,
      status: row?.status ?? "none",
      active: false,
      cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: row?.currentPeriodEnd ?? null,
      extraSeats: 0,
    };
  }

  const plan = PLANS[row.plan] ?? fallback;
  return {
    plan: plan.id,
    planName: plan.name,
    limits: {
      ...plan.limits,
      // Extra seats are billed per seat on top of the plan's allowance.
      seats: plan.limits.seats + Math.max(0, row.extraSeats),
    },
    features: plan.features,
    status: row.status,
    active: true,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodEnd: row.currentPeriodEnd,
    extraSeats: Math.max(0, row.extraSeats),
  };
}

/**
 * What this organization is allowed to do.
 *
 * Reads the local subscription row that the Stripe webhook keeps up to date —
 * never Stripe itself, so billing can be down without taking dashboards with
 * it. Self-hosted short-circuits before touching the database at all.
 */
export async function entitlementsFor(
  organizationId: string,
): Promise<Entitlements> {
  if (!isCloud) return SELF_HOSTED;

  const db = await getDb();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);

  return entitlementsFromRow(row ?? null);
}

/**
 * `entitlementsFor`, for many organizations in one read.
 *
 * For maintenance that walks every tenant — history retention — where asking
 * one organization at a time is one query per customer. Every id passed in
 * gets an entry; one without a subscription row gets the trial, exactly as
 * `entitlementsFor` would give it.
 */
export async function entitlementsForMany(
  organizationIds: string[],
): Promise<Map<string, Entitlements>> {
  if (!isCloud) {
    return new Map(organizationIds.map((id) => [id, SELF_HOSTED]));
  }
  if (organizationIds.length === 0) return new Map();

  const db = await getDb();
  const rows = await db
    .select()
    .from(subscriptions)
    .where(inArray(subscriptions.organizationId, organizationIds));
  const byOrganization = new Map(rows.map((row) => [row.organizationId, row]));

  return new Map(
    organizationIds.map((id) => [
      id,
      entitlementsFromRow(byOrganization.get(id) ?? null),
    ]),
  );
}

export type LimitName = keyof PlanLimits;

export type LimitCheck =
  | { allowed: true }
  | { allowed: false; limit: number; plan: PlanId; message: string };

const LIMIT_LABELS: Record<LimitName, string> = {
  dashboards: "dashboards",
  widgetsPerDashboard: "widgets on a dashboard",
  connections: "connections",
  seats: "members",
  historyDays: "days of history",
};

/**
 * Whether one more of something fits within the plan.
 *
 * `current` is counted at the moment of the check rather than tracked, so a
 * plan downgrade never leaves a stale counter behind — existing rows keep
 * working, only adding more is refused.
 */
export function checkLimit(
  entitlements: Entitlements,
  limit: LimitName,
  current: number,
): LimitCheck {
  const max = entitlements.limits[limit];
  if (current < max) return { allowed: true };

  return {
    allowed: false,
    limit: max,
    plan: entitlements.plan,
    message: `Your ${entitlements.planName} plan includes ${max} ${LIMIT_LABELS[limit]}. Upgrade to add more.`,
  };
}

/** Whether a plan includes a feature at all, regardless of usage. */
export function hasFeature(
  entitlements: Entitlements,
  feature: keyof Omit<PlanFeatures, "alertChannels">,
): boolean {
  return entitlements.features[feature];
}

export function allowsAlertChannel(
  entitlements: Entitlements,
  channel: AlertChannel,
): boolean {
  return entitlements.features.alertChannels.includes(channel);
}
