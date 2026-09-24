import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/stripe.json";
import {
  fail,
  mockFetch,
  ok,
  setupConnectorTest,
  type MockRequest,
  type MockRoute,
} from "./__fixtures__/mock-fetch";
import { toUserFacingError } from "./errors";
import { fetchStripeDashboard, stripeConnector } from "./stripe";

setupConnectorTest("2026-09-20T12:00:00.000Z");

const credentials = { apiKey: " sk_live_abc " };

type Overrides = {
  subscriptions?: MockRoute["respond"];
  charges?: MockRoute["respond"];
  balance?: MockRoute["respond"];
};

/** Two pages of subscriptions: page two starts after page one's last id. */
function subscriptionPages(request: MockRequest) {
  return request.url.includes("starting_after=sub_3Ptrial")
    ? ok(fixtures.subscriptionsPage2)
    : ok(fixtures.subscriptionsPage1);
}

function routes(overrides: Overrides = {}): MockRoute[] {
  return [
    {
      match: "api.stripe.com/v1/subscriptions",
      respond: overrides.subscriptions ?? subscriptionPages,
    },
    {
      match: "api.stripe.com/v1/charges",
      respond: overrides.charges ?? ok(fixtures.charges),
    },
    {
      match: "api.stripe.com/v1/balance",
      respond: overrides.balance ?? ok(fixtures.balance),
    },
  ];
}

describe("fetchStripeDashboard", () => {
  it("normalises revenue, volume, payments and balance", async () => {
    const http = mockFetch(routes());
    const dash = await stripeConnector.fetchDashboard(credentials);

    expect(http.unmatched).toEqual([]);
    expect(http.calls[0].headers.authorization).toBe("Bearer sk_live_abc");
    expect(http.calls[0].headers["stripe-version"]).toBe("2026-08-26.dahlia");

    // 29 monthly + 2 × 290 yearly / 12 + 90 quarterly / 3; the trial and the
    // canceled plan add nothing.
    expect(dash.revenue.mrr).toBeCloseTo(29 + 48.3333 + 30, 3);
    expect(dash.revenue).toMatchObject({
      currency: "eur",
      activeSubscriptions: 3,
      trialingSubscriptions: 1,
      truncated: false,
    });

    // Only succeeded, unrefunded charges count toward volume.
    expect(dash.volume30d).toEqual({
      label: "Last 30 days",
      value: 319,
      display: "2 payments",
    });

    expect(dash.payments).toEqual([
      {
        id: "ch_3Psucceeded",
        description: "Pro (yearly)",
        amount: 290,
        currency: "eur",
        status: "succeeded",
        createdAt: "2026-09-20T10:00:00.000Z",
        customer: "Grace Hopper",
      },
      {
        id: "ch_3Prefunded",
        description: "Team seat",
        amount: 49,
        currency: "eur",
        status: "refunded",
        createdAt: "2026-09-19T10:00:00.000Z",
        customer: "linus@example.com",
      },
      {
        id: "ch_3Pfailed",
        description: "Pro (monthly)",
        amount: 29,
        currency: "eur",
        status: "failed",
        createdAt: "2026-09-18T10:00:00.000Z",
        customer: "ada@example.com",
      },
      {
        id: "ch_3Ppending",
        description: "Payment",
        amount: 90,
        currency: "eur",
        status: "pending",
        createdAt: "2026-09-17T10:00:00.000Z",
        customer: undefined,
      },
      {
        id: "ch_3Pmonthly",
        description: "Pro (monthly)",
        amount: 29,
        currency: "eur",
        status: "succeeded",
        createdAt: "2026-09-16T10:00:00.000Z",
        customer: "Barbara Liskov",
      },
    ]);

    expect(dash.balance).toEqual({ currency: "eur", available: 4820, pending: 129.5 });
  });

  it("asks only for the trailing 30 days of charges", async () => {
    const http = mockFetch(routes());
    await fetchStripeDashboard(credentials);

    const [charges] = http.callsTo("/v1/charges");
    // 2026-08-21T12:00:00Z, thirty days before the frozen now.
    expect(charges.url).toContain("limit=25&created[gte]=1787313600");
  });

  it("follows the starting_after cursor across subscription pages", async () => {
    const http = mockFetch(routes());
    await fetchStripeDashboard(credentials);

    const pages = http.callsTo("/v1/subscriptions");
    expect(pages).toHaveLength(2);
    expect(new URL(pages[0].url).searchParams.get("starting_after")).toBeNull();
    expect(new URL(pages[1].url).searchParams.get("starting_after")).toBe(
      "sub_3Ptrial",
    );
    // Prices are expanded, or `unit_amount` would be missing from every item.
    expect(new URL(pages[0].url).searchParams.get("expand[]")).toBe(
      "data.items.data.price",
    );
  });

  it("stops after five pages and flags the MRR as partial", async () => {
    let page = 0;
    const http = mockFetch(
      routes({
        subscriptions: () => {
          page++;
          return ok({
            ...fixtures.subscriptionsPage1,
            has_more: true,
            data: fixtures.subscriptionsPage1.data.map((s) => ({
              ...s,
              id: `${s.id}_p${page}`,
            })),
          });
        },
      }),
    );
    const dash = await fetchStripeDashboard(credentials);

    expect(http.callsTo("/v1/subscriptions")).toHaveLength(5);
    expect(dash.revenue.truncated).toBe(true);
    expect(dash.revenue.activeSubscriptions).toBe(10);
  });

  it("renders an account with no activity as zeros, not gaps", async () => {
    mockFetch(
      routes({
        subscriptions: ok({ object: "list", has_more: false, data: [] }),
        charges: ok({ object: "list", has_more: false, data: [] }),
        balance: ok({ object: "balance", available: [], pending: [] }),
      }),
    );
    const dash = await fetchStripeDashboard(credentials);

    expect(dash).toEqual({
      revenue: {
        currency: "eur",
        mrr: 0,
        activeSubscriptions: 0,
        trialingSubscriptions: 0,
        truncated: false,
      },
      volume30d: { label: "Last 30 days", value: 0, display: "0 payments" },
      payments: [],
      balance: { currency: "eur", available: 0, pending: 0 },
    });
  });

  it("drops only the balance when a restricted key cannot read it", async () => {
    mockFetch(routes({ balance: fail(403, fixtures.restrictedKey) }));
    const dash = await fetchStripeDashboard(credentials);

    expect(dash.balance).toBeNull();
    expect(dash.payments).toHaveLength(5);
    expect(dash.revenue.activeSubscriptions).toBe(3);
  });

  it("fails as a whole when charges cannot be read", async () => {
    mockFetch(routes({ charges: fail(429, fixtures.rateLimited) }));
    const error = await fetchStripeDashboard(credentials).catch((e) => e);
    expect(toUserFacingError(error, "stripe")).toBe(
      "Provider rate limit hit. Try again in a moment.",
    );
  });

  it("refuses to call Stripe without a key", async () => {
    const http = mockFetch([]);
    await expect(fetchStripeDashboard({ apiKey: "  " })).rejects.toThrow(
      "Stripe API key is required",
    );
    expect(http.calls).toEqual([]);
  });
});

describe("stripeConnector.test", () => {
  it("accepts a key that can read the balance", async () => {
    mockFetch(routes());
    expect(await stripeConnector.test(credentials)).toEqual({
      ok: true,
      message: "Connected to Stripe",
    });
  });

  it("explains an invalid key", async () => {
    mockFetch(routes({ balance: fail(401, fixtures.invalidKey) }));
    expect(await stripeConnector.test(credentials)).toEqual({
      ok: false,
      message: "Authentication failed. Check the API token and try again.",
    });
  });

  it("explains a key without the permission", async () => {
    mockFetch(routes({ balance: fail(403, fixtures.restrictedKey) }));
    expect((await stripeConnector.test(credentials)).message).toBe(
      "Access denied. This token may lack the required permissions.",
    );
  });
});
