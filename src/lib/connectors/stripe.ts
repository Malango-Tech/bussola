import type {
  ConnectionCredentials,
  Connector,
  PaymentItem,
  RevenueSummary,
  StripeDashboard,
  TestResult,
} from "./types";
import { toUserFacingError } from "./errors";
import { fetchJson } from "./http";
import { daysAgo } from "./shared/dates";
import { toMajor } from "./shared/money";
import { collectPages } from "./shared/pagination";

const BASE = "https://api.stripe.com/v1";
const SUBSCRIPTION_PAGES = 5;
const PER_PAGE = 100;
const RECENT_PAYMENTS = 25;

async function stripeFetch<T>(key: string, path: string): Promise<T> {
  return fetchJson<T>(
    `${BASE}${path}`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
        // Pinned so a Stripe-side default change cannot reshape these payloads.
        "Stripe-Version": "2026-08-26.dahlia",
      },
    },
    { label: "Stripe" },
  );
}

type StripeList<T> = { data: T[]; has_more: boolean };

type StripePrice = {
  unit_amount?: number | null;
  currency?: string;
  recurring?: { interval?: string; interval_count?: number } | null;
};

type StripeSubscription = {
  id: string;
  status: string;
  currency?: string;
  items?: { data: Array<{ quantity?: number; price?: StripePrice }> };
};

type StripeCharge = {
  id: string;
  amount: number;
  currency: string;
  description?: string | null;
  status: string;
  refunded?: boolean;
  created: number;
  billing_details?: { name?: string | null; email?: string | null } | null;
};

/**
 * Normalise a recurring price to a monthly amount.
 *
 * Stripe expresses intervals as day/week/month/year with a multiplier, so a
 * yearly plan and a quarterly one both have to be reduced to one month before
 * they can be added up. Anything non-recurring contributes nothing to MRR.
 */
export function monthlyAmount(price: StripePrice | undefined): number {
  const amount = price?.unit_amount;
  const interval = price?.recurring?.interval;
  if (!amount || !interval) return 0;

  const count = price.recurring?.interval_count || 1;
  const perMonth =
    interval === "month"
      ? 1 / count
      : interval === "year"
        ? 1 / (12 * count)
        : interval === "week"
          ? 52 / (12 * count)
          : interval === "day"
            ? 365 / (12 * count)
            : 0;

  return amount * perMonth;
}

export function chargeStatus(charge: {
  status: string;
  refunded?: boolean;
}): PaymentItem["status"] {
  if (charge.refunded) return "refunded";
  switch (charge.status) {
    case "succeeded":
      return "succeeded";
    case "pending":
      return "pending";
    default:
      return "failed";
  }
}

async function fetchSubscriptions(key: string): Promise<RevenueSummary> {
  const { items: subscriptions, truncated } = await collectPages<
    StripeSubscription,
    string
  >(async (startingAfter) => {
    const query = new URLSearchParams({
      status: "all",
      limit: String(PER_PAGE),
      "expand[]": "data.items.data.price",
    });
    if (startingAfter) query.set("starting_after", startingAfter);

    const list = await stripeFetch<StripeList<StripeSubscription>>(
      key,
      `/subscriptions?${query.toString()}`,
    );
    return {
      items: list.data,
      // Stripe pages by object id: the next page starts after this one's last.
      next: list.has_more ? list.data.at(-1)?.id : null,
    };
  }, SUBSCRIPTION_PAGES);

  let mrr = 0;
  let active = 0;
  let trialing = 0;
  let currency = "eur";

  for (const subscription of subscriptions) {
    if (subscription.currency) currency = subscription.currency;
    if (subscription.status === "trialing") trialing++;
    if (subscription.status !== "active") continue;

    active++;
    for (const item of subscription.items?.data ?? []) {
      mrr += monthlyAmount(item.price) * (item.quantity ?? 1);
    }
  }

  return {
    currency,
    mrr: toMajor(mrr),
    activeSubscriptions: active,
    trialingSubscriptions: trialing,
    truncated,
  };
}

export const stripeConnector: Connector = {
  provider: "stripe",
  async test(credentials: ConnectionCredentials): Promise<TestResult> {
    const key = credentials.apiKey?.trim();
    if (!key) return { ok: false, message: "API key is required" };

    try {
      // Cheapest authenticated call Stripe offers.
      await stripeFetch<{ object: string }>(key, "/balance");
      return { ok: true, message: "Connected to Stripe" };
    } catch (error) {
      return { ok: false, message: toUserFacingError(error, "stripe") };
    }
  },
};

export async function fetchStripeDashboard(
  credentials: ConnectionCredentials,
): Promise<StripeDashboard> {
  const key = credentials.apiKey?.trim();
  if (!key) throw new Error("Stripe API key is required");

  const since = Math.floor(daysAgo(30).getTime() / 1000);

  const [revenue, charges, balance] = await Promise.all([
    fetchSubscriptions(key),
    stripeFetch<StripeList<StripeCharge>>(
      key,
      `/charges?limit=${RECENT_PAYMENTS}&created[gte]=${since}`,
    ),
    stripeFetch<{
      available?: Array<{ amount: number; currency: string }>;
      pending?: Array<{ amount: number; currency: string }>;
    }>(key, "/balance").catch(() => null),
  ]);

  const succeeded = charges.data.filter(
    (charge) => charge.status === "succeeded" && !charge.refunded,
  );
  const volume = succeeded.reduce((sum, charge) => sum + charge.amount, 0);
  const currency = succeeded[0]?.currency ?? revenue.currency;

  return {
    revenue,
    volume30d: {
      label: "Last 30 days",
      value: toMajor(volume),
      display: `${succeeded.length} payments`,
    },
    payments: charges.data.map(
      (charge): PaymentItem => ({
        id: charge.id,
        description: charge.description || "Payment",
        amount: toMajor(charge.amount),
        currency: charge.currency,
        status: chargeStatus(charge),
        createdAt: new Date(charge.created * 1000).toISOString(),
        customer:
          charge.billing_details?.name ||
          charge.billing_details?.email ||
          undefined,
      }),
    ),
    balance: balance
      ? {
          currency: balance.available?.[0]?.currency ?? currency,
          available: toMajor(balance.available?.[0]?.amount ?? 0),
          pending: toMajor(balance.pending?.[0]?.amount ?? 0),
        }
      : null,
  };
}
