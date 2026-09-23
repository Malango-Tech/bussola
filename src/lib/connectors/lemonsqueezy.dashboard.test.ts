import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/lemonsqueezy.json";
import {
  fail,
  mockFetch,
  ok,
  setupConnectorTest,
  warnings,
  type MockRequest,
  type MockRoute,
} from "./__fixtures__/mock-fetch";
import { toUserFacingError } from "./errors";
import {
  fetchLemonSqueezyDashboard,
  lemonsqueezyConnector,
} from "./lemonsqueezy";

setupConnectorTest("2026-09-20T12:00:00.000Z");

const credentials = { apiKey: "ls_live_key" };

type Overrides = Partial<
  Record<"stores" | "orders" | "subscriptions" | "invoices", MockRoute["respond"]>
>;

function subscriptionPage(request: MockRequest) {
  return request.url.includes("page[number]=2")
    ? ok(fixtures.subscriptionsPage2)
    : ok(fixtures.subscriptionsPage1);
}

function routes(overrides: Overrides = {}): MockRoute[] {
  return [
    { match: "/v1/stores", respond: overrides.stores ?? ok(fixtures.stores) },
    { match: "/v1/orders?", respond: overrides.orders ?? ok(fixtures.orders) },
    {
      match: "/v1/subscriptions?",
      respond: overrides.subscriptions ?? subscriptionPage,
    },
    {
      match: "/v1/subscription-invoices?",
      respond: overrides.invoices ?? ok(fixtures.subscriptionInvoices),
    },
  ];
}

describe("fetchLemonSqueezyDashboard", () => {
  it("normalises the store, revenue and orders", async () => {
    const http = mockFetch(routes());
    const dash = await lemonsqueezyConnector.fetchDashboard(credentials);

    expect(http.unmatched).toEqual([]);
    // Lemon Squeezy only speaks JSON:API.
    expect(http.calls[0].headers.accept).toBe("application/vnd.api+json");

    expect(dash.storeName).toBe("Pixel Press");
    expect(dash.revenue).toEqual({
      currency: "usd",
      // Paid invoices from the last 30 days: 29 + 49. The one from 36 days
      // ago falls outside the window.
      mrr: 78,
      // `active` and `past_due` are both still billing.
      activeSubscriptions: 2,
      trialingSubscriptions: 1,
      truncated: false,
    });
    expect(dash.revenue30d).toEqual({
      label: "Last 30 days",
      value: 849,
      display: "4 orders",
    });

    expect(dash.orders).toEqual([
      {
        id: "902211",
        description: "Pixel Press Pro",
        amount: 29,
        currency: "usd",
        status: "succeeded",
        createdAt: "2026-09-20T09:30:00.000000Z",
        customer: "Grace Hopper",
      },
      {
        id: "902198",
        description: "Icon Pack",
        amount: 49,
        currency: "eur",
        status: "refunded",
        createdAt: "2026-09-19T15:00:00.000000Z",
        customer: "linus@example.com",
      },
      {
        // No line item: the order identifier stands in, in the store currency.
        id: "902150",
        description: "2a1b3c4d-0003-4e5f-8a9b-000000000003",
        amount: 19,
        currency: "usd",
        status: "pending",
        createdAt: "2026-09-18T11:00:00.000000Z",
        customer: "Ada Lovelace",
      },
      {
        id: "902101",
        description: "Pixel Press Pro",
        amount: 99,
        currency: "usd",
        status: "failed",
        createdAt: "2026-09-17T11:00:00.000000Z",
        customer: undefined,
      },
    ]);
  });

  it("walks subscription pages until lastPage", async () => {
    const http = mockFetch(routes());
    await fetchLemonSqueezyDashboard(credentials);

    expect(http.callsTo("/v1/subscriptions?").map((c) => c.url)).toEqual([
      "https://api.lemonsqueezy.com/v1/subscriptions?page[size]=100&page[number]=1",
      "https://api.lemonsqueezy.com/v1/subscriptions?page[size]=100&page[number]=2",
    ]);
  });

  it("stops after five pages and flags the counts as partial", async () => {
    const http = mockFetch(
      routes({
        subscriptions: ok({
          ...fixtures.subscriptionsPage1,
          meta: { page: { currentPage: 1, lastPage: 40 } },
        }),
      }),
    );
    const dash = await fetchLemonSqueezyDashboard(credentials);

    expect(http.callsTo("/v1/subscriptions?")).toHaveLength(5);
    expect(dash.revenue.truncated).toBe(true);
    expect(dash.revenue.activeSubscriptions).toBe(5);
  });

  it("shows MRR as zero, with a warning, when invoices cannot be read", async () => {
    mockFetch(routes({ invoices: fail(500, "Internal Server Error") }));
    const dash = await fetchLemonSqueezyDashboard(credentials);

    expect(dash.revenue.mrr).toBe(0);
    expect(dash.orders).toHaveLength(4);
    expect(warnings()).toEqual([
      "[connector:lemonsqueezy] subscription invoices unavailable; MRR shown as 0",
    ]);
  });

  it("renders a brand-new store", async () => {
    const empty = { meta: { page: { currentPage: 1, lastPage: 1 } }, data: [] };
    mockFetch(
      routes({
        stores: ok({
          data: [
            {
              type: "stores",
              id: "1",
              attributes: { name: "New Shop", currency: "EUR", thirty_day_revenue: 0 },
            },
          ],
        }),
        orders: ok(empty),
        subscriptions: ok(empty),
        invoices: ok(empty),
      }),
    );
    const dash = await fetchLemonSqueezyDashboard(credentials);

    expect(dash).toEqual({
      storeName: "New Shop",
      revenue: {
        currency: "eur",
        mrr: 0,
        activeSubscriptions: 0,
        trialingSubscriptions: 0,
        truncated: false,
      },
      revenue30d: { label: "Last 30 days", value: 0, display: "0 orders" },
      orders: [],
    });
  });

  it("fails as a whole when the key is rejected", async () => {
    mockFetch(routes({ stores: fail(401, fixtures.unauthenticated) }));
    const error = await fetchLemonSqueezyDashboard(credentials).catch((e) => e);
    expect(toUserFacingError(error, "lemonsqueezy")).toBe(
      "Authentication failed. Check the API token and try again.",
    );
  });
});

describe("lemonsqueezyConnector.test", () => {
  it("names the store", async () => {
    mockFetch(routes());
    expect(await lemonsqueezyConnector.test(credentials)).toEqual({
      ok: true,
      message: "Connected to Pixel Press",
    });
  });

  it("maps a rejected key", async () => {
    mockFetch(routes({ stores: fail(401, fixtures.unauthenticated) }));
    expect(await lemonsqueezyConnector.test(credentials)).toEqual({
      ok: false,
      message: "Authentication failed. Check the API token and try again.",
    });
  });

  it("asks for a key before calling out", async () => {
    const http = mockFetch([]);
    expect(await lemonsqueezyConnector.test({})).toEqual({
      ok: false,
      message: "API key is required",
    });
    expect(http.calls).toEqual([]);
  });
});
