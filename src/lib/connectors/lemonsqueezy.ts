import type {
  ConnectionCredentials,
  Connector,
  LemonSqueezyDashboard,
  PaymentItem,
  RevenueSummary,
  TestResult,
} from "./types";
import { toUserFacingError } from "./errors";
import { fetchJson } from "./http";
import { daysAgo } from "./shared/dates";
import { connectorLogger } from "./shared/log";
import { toMajor } from "./shared/money";
import { collectPages } from "./shared/pagination";

const BASE = "https://api.lemonsqueezy.com/v1";
const RECENT_ORDERS = 25;
const SUBSCRIPTION_PAGES = 5;
const PER_PAGE = 100;

const log = connectorLogger("lemonsqueezy");

async function lsFetch<T>(key: string, path: string): Promise<T> {
  return fetchJson<T>(
    `${BASE}${path}`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
        // Lemon Squeezy speaks JSON:API and rejects anything else.
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
      },
    },
    { label: "Lemon Squeezy" },
  );
}

type JsonApiList<T> = {
  data: Array<{ id: string; attributes: T }>;
  meta?: { page?: { lastPage?: number; currentPage?: number } };
};

type StoreAttributes = {
  name?: string;
  currency?: string;
  total_revenue?: number;
  thirty_day_revenue?: number;
};

type SubscriptionAttributes = {
  status?: string;
  product_name?: string;
  variant_name?: string;
  first_subscription_item?: { price_id?: number } | null;
};

type OrderAttributes = {
  identifier?: string;
  status?: string;
  currency?: string;
  total?: number;
  user_email?: string;
  user_name?: string;
  created_at?: string;
  first_order_item?: { product_name?: string; variant_name?: string } | null;
};

type SubscriptionInvoiceAttributes = {
  status?: string;
  currency?: string;
  total?: number;
  billing_reason?: string;
  created_at?: string;
};

export function orderStatus(status?: string): PaymentItem["status"] {
  switch (status) {
    case "paid":
      return "succeeded";
    case "pending":
      return "pending";
    case "refunded":
    case "partial_refund":
      return "refunded";
    default:
      return "failed";
  }
}

/**
 * Lemon Squeezy does not expose MRR directly, so it is derived from the
 * subscriptions that are actually billing. `on_trial` is counted separately
 * rather than as revenue that has not happened yet.
 */
function summarise(
  subscriptions: Array<{ attributes: SubscriptionAttributes }>,
  invoicesByStatus: Map<string, number>,
  currency: string,
  truncated: boolean,
): RevenueSummary {
  let active = 0;
  let trialing = 0;

  for (const { attributes } of subscriptions) {
    if (attributes.status === "on_trial") trialing++;
    if (attributes.status === "active" || attributes.status === "past_due") {
      active++;
    }
  }

  return {
    currency,
    mrr: invoicesByStatus.get("mrr") ?? 0,
    activeSubscriptions: active,
    trialingSubscriptions: trialing,
    truncated,
  };
}

export const lemonsqueezyConnector: Connector = {
  provider: "lemonsqueezy",
  async test(credentials: ConnectionCredentials): Promise<TestResult> {
    const key = credentials.apiKey?.trim();
    if (!key) return { ok: false, message: "API key is required" };

    try {
      const stores = await lsFetch<JsonApiList<StoreAttributes>>(
        key,
        "/stores",
      );
      const name = stores.data[0]?.attributes.name;
      return {
        ok: true,
        message: name ? `Connected to ${name}` : "Connected to Lemon Squeezy",
      };
    } catch (error) {
      return { ok: false, message: toUserFacingError(error, "lemonsqueezy") };
    }
  },
};

export async function fetchLemonSqueezyDashboard(
  credentials: ConnectionCredentials,
): Promise<LemonSqueezyDashboard> {
  const key = credentials.apiKey?.trim();
  if (!key) throw new Error("Lemon Squeezy API key is required");

  const [stores, orders] = await Promise.all([
    lsFetch<JsonApiList<StoreAttributes>>(key, "/stores"),
    lsFetch<JsonApiList<OrderAttributes>>(
      key,
      `/orders?page[size]=${RECENT_ORDERS}&sort=-createdAt`,
    ),
  ]);

  const store = stores.data[0]?.attributes;
  const currency = (store?.currency || "usd").toLowerCase();

  // Subscriptions are paginated; cap the walk so one huge store cannot stall
  // the sync worker's whole batch.
  const { items: subscriptions, truncated } = await collectPages<
    { attributes: SubscriptionAttributes },
    number
  >(async (page = 1) => {
    const list = await lsFetch<JsonApiList<SubscriptionAttributes>>(
      key,
      `/subscriptions?page[size]=${PER_PAGE}&page[number]=${page}`,
    );
    const lastPage = list.meta?.page?.lastPage ?? page;
    return { items: list.data, next: page < lastPage ? page + 1 : null };
  }, SUBSCRIPTION_PAGES);

  // MRR from the most recent paid subscription invoices, normalised to a month.
  const mrrByStatus = new Map<string, number>();
  const invoices = await lsFetch<JsonApiList<SubscriptionInvoiceAttributes>>(
    key,
    `/subscription-invoices?page[size]=${PER_PAGE}&filter[status]=paid`,
  ).catch((error: unknown) => {
    // MRR then reads as zero, which looks like a real figure — so say why.
    log.warn("subscription invoices unavailable; MRR shown as 0", {}, error);
    return null;
  });

  if (invoices) {
    const monthAgo = daysAgo(30).getTime();
    const recent = invoices.data.filter((invoice) => {
      const created = invoice.attributes.created_at;
      return created ? new Date(created).getTime() >= monthAgo : false;
    });
    mrrByStatus.set(
      "mrr",
      toMajor(
        recent.reduce((sum, invoice) => sum + (invoice.attributes.total ?? 0), 0),
      ),
    );
  }

  return {
    storeName: store?.name,
    revenue: summarise(subscriptions, mrrByStatus, currency, truncated),
    revenue30d: {
      label: "Last 30 days",
      value: toMajor(store?.thirty_day_revenue),
      display: `${orders.data.length} orders`,
    },
    orders: orders.data.map(
      ({ id, attributes }): PaymentItem => ({
        id,
        description:
          attributes.first_order_item?.product_name ||
          attributes.identifier ||
          "Order",
        amount: toMajor(attributes.total),
        currency: (attributes.currency || currency).toLowerCase(),
        status: orderStatus(attributes.status),
        createdAt: attributes.created_at || new Date().toISOString(),
        customer: attributes.user_name || attributes.user_email || undefined,
      }),
    ),
  };
}
