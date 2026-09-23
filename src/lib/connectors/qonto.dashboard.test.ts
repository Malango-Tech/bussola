import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/qonto.json";
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
  fetchQontoDashboard,
  fetchQontoTransactionsPage,
  qontoConnector,
} from "./qonto";

setupConnectorTest("2026-09-20T12:00:00.000Z");

const credentials = { login: "atelier-lune-1234", secretKey: "s3cr3t-key" };
const MAIN = "acc-main-0001";
const TAX = "acc-tax-0002";

/** The fields the fake server filters on; the rest pass through untouched. */
type QontoTx = {
  id: string;
  bank_account_id: string;
  status: string;
  settled_at: string | null;
  emitted_at?: string;
  [field: string]: unknown;
};

/** A transaction in Qonto's shape, for the volume and cursor tests. */
function tx(id: string, account: string, settledAt: string): QontoTx {
  return {
    transaction_id: `atelier-lune-1234-${id}`,
    id,
    amount: 10,
    amount_cents: 1000,
    side: "debit",
    operation_type: "card",
    currency: "EUR",
    label: `Purchase ${id}`,
    settled_at: settledAt,
    emitted_at: settledAt,
    updated_at: settledAt,
    status: "completed",
    bank_account_id: account,
  };
}

function when(transaction: QontoTx): number {
  return Date.parse(transaction.settled_at ?? transaction.emitted_at ?? "");
}

/**
 * `/v2/transactions` as Qonto serves it: filtered by account, status and
 * settlement window, newest first, paged by number with a `next_page` link.
 */
function transactionsServer(dataset: QontoTx[]) {
  return (request: MockRequest) => {
    const params = new URL(request.url).searchParams;
    const perPage = Number(params.get("per_page"));
    const page = Number(params.get("page") ?? "1");
    const from = params.get("settled_at_from");
    const to = params.get("settled_at_to");
    const statuses = params.getAll("status[]");

    const rows = dataset
      .filter((t) => t.bank_account_id === params.get("bank_account_id"))
      .filter((t) => statuses.length === 0 || statuses.includes(t.status))
      .filter((t) => !from || when(t) >= Date.parse(from))
      .filter((t) => !to || when(t) <= Date.parse(to))
      .sort((a, b) => when(b) - when(a));

    const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
    return ok({
      transactions: rows.slice((page - 1) * perPage, page * perPage),
      meta: {
        current_page: page,
        next_page: page < totalPages ? page + 1 : null,
        prev_page: page > 1 ? page - 1 : null,
        total_pages: totalPages,
        total_count: rows.length,
        per_page: perPage,
      },
    });
  };
}

function routes(
  overrides: { organization?: MockRoute["respond"]; transactions?: MockRoute["respond"] } = {},
): MockRoute[] {
  return [
    {
      match: "thirdparty.qonto.com/v2/organization",
      respond: overrides.organization ?? ok(fixtures.organization),
    },
    {
      match: "thirdparty.qonto.com/v2/transactions?",
      respond: overrides.transactions ?? transactionsServer(fixtures.transactions),
    },
  ];
}

describe("fetchQontoDashboard", () => {
  it("reports balances for open, internal accounts only, main account first", async () => {
    const http = mockFetch(routes());
    const dash = await qontoConnector.fetchDashboard(credentials);

    expect(http.unmatched).toEqual([]);
    expect(dash.organizationName).toBe("Atelier Lune SAS");
    expect(dash.balances).toEqual([
      {
        currency: "EUR",
        balance: 12450.5,
        authorizedBalance: 12100.5,
        accountName: "Compte principal",
        main: true,
        sharePct: 78.1,
      },
      {
        // Only cents on this one: read from `*_cents`.
        currency: "EUR",
        balance: 3500,
        authorizedBalance: 3500,
        accountName: "Provision TVA",
        main: false,
        sharePct: 21.9,
      },
    ]);
    expect(dash.liquidity).toEqual({
      currency: "EUR",
      booked: 15950.5,
      available: 15600.5,
      pendingDelta: 350,
      accountCount: 2,
    });

    // The closed and the external account are never asked for transactions.
    const asked = http
      .callsTo("/v2/transactions")
      .map((c) => new URL(c.url).searchParams.get("bank_account_id"));
    expect(asked.sort()).toEqual([MAIN, TAX]);
  });

  it("sums completed transactions over 30 days into cashflow", async () => {
    const http = mockFetch(routes());
    const dash = await fetchQontoDashboard(credentials);

    const params = new URL(http.callsTo("/v2/transactions")[0].url).searchParams;
    expect(params.get("settled_at_from")).toBe("2026-08-21T12:00:00.000Z");
    expect(params.getAll("status[]")).toEqual(["completed", "pending"]);
    expect(params.get("sort_by")).toBe("settled_at:desc");

    // The pending card payment is fetched but not yet cashflow.
    expect(dash.cashflow30d.inflow).toBe(1200);
    expect(dash.cashflow30d.outflow).toBeCloseTo(389.99, 2);
    expect(dash.cashflow30d.net).toBeCloseTo(810.01, 2);
    expect(dash.cashflow30d).toMatchObject({
      currency: "EUR",
      days: 30,
      transactionCount: 3,
    });
  });

  it("rebuilds daily balances backwards from today's", async () => {
    mockFetch(routes());
    const { balanceHistory } = await fetchQontoDashboard(credentials);

    expect(balanceHistory.days).toBe(30);
    expect(balanceHistory.incomplete).toBe(false);
    expect(balanceHistory.points).toHaveLength(30);
    expect(balanceHistory.points[0].date).toBe("2026-08-22");

    const byDate = Object.fromEntries(
      balanceHistory.points.map((p) => [p.date, p.balance]),
    );
    expect(byDate["2026-09-20"]).toBe(15950.5);
    // The pending payment on the 19th does not move the booked balance.
    expect(byDate["2026-09-18"]).toBe(15950.5);
    // Before the 1 200 credit landed on the 18th.
    expect(byDate["2026-09-17"]).toBe(14750.5);
    // Before the 89.99 debit on the 15th.
    expect(byDate["2026-09-14"]).toBe(14840.49);
    // Before the 300 debit on the 10th, from the other account.
    expect(byDate["2026-09-09"]).toBe(15140.49);
    expect(byDate["2026-08-22"]).toBe(15140.49);
  });

  it("follows next_page until the account is exhausted", async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      tx(`tx-${i}`, MAIN, new Date(Date.UTC(2026, 8, 20, 11) - i * 60_000).toISOString()),
    );
    const http = mockFetch(routes({ transactions: transactionsServer(many) }));
    const dash = await fetchQontoDashboard(credentials);

    const mainPages = http
      .callsTo(`bank_account_id=${MAIN}`)
      .map((c) => new URL(c.url).searchParams.get("page"));
    expect(mainPages).toEqual(["1", "2", "3"]);
    expect(dash.cashflow30d.transactionCount).toBe(250);
    expect(dash.balanceHistory.incomplete).toBe(false);
  });

  it("stops after five pages and marks the history incomplete", async () => {
    const many = Array.from({ length: 620 }, (_, i) =>
      tx(`tx-${i}`, MAIN, new Date(Date.UTC(2026, 8, 20, 11) - i * 60_000).toISOString()),
    );
    const http = mockFetch(routes({ transactions: transactionsServer(many) }));
    const dash = await fetchQontoDashboard(credentials);

    expect(http.callsTo(`bank_account_id=${MAIN}`)).toHaveLength(5);
    expect(dash.cashflow30d.transactionCount).toBe(500);
    expect(dash.balanceHistory.incomplete).toBe(true);
  });

  it("keeps balances, and warns, when one account's transactions fail", async () => {
    const server = transactionsServer(fixtures.transactions);
    mockFetch(
      routes({
        transactions: (request) =>
          request.url.includes(TAX) ? fail(500, "Internal Server Error") : server(request),
      }),
    );
    const dash = await fetchQontoDashboard(credentials);

    expect(dash.balances).toHaveLength(2);
    expect(dash.cashflow30d.outflow).toBeCloseTo(89.99, 2);
    expect(warnings()).toEqual([
      `[connector:qonto] account transactions unavailable {"accountId":"${TAX}"}`,
    ]);
  });

  it("renders an organization with no accounts without asking for transactions", async () => {
    const http = mockFetch(
      routes({
        organization: ok({
          organization: { name: "Nouvelle SAS", slug: "nouvelle", bank_accounts: [] },
        }),
      }),
    );
    const dash = await fetchQontoDashboard(credentials);

    expect(http.callsTo("/v2/transactions")).toEqual([]);
    expect(dash.balances).toEqual([]);
    expect(dash.liquidity).toEqual({
      currency: "EUR",
      booked: 0,
      available: 0,
      pendingDelta: 0,
      accountCount: 0,
    });
    expect(dash.cashflow30d).toEqual({
      currency: "EUR",
      inflow: 0,
      outflow: 0,
      net: 0,
      days: 30,
      transactionCount: 0,
    });
    expect(dash.balanceHistory.points.every((p) => p.balance === 0)).toBe(true);
  });
});

describe("Qonto authentication", () => {
  it("sends login:secret raw, not as HTTP Basic", async () => {
    const http = mockFetch(routes());
    await qontoConnector.test(credentials);
    expect(http.calls[0].headers.authorization).toBe("atelier-lune-1234:s3cr3t-key");
  });

  it("accepts a combined key, or an OAuth token as a bearer", async () => {
    const http = mockFetch(routes());
    await qontoConnector.test({ apiKey: "atelier-lune-1234:s3cr3t-key" });
    await qontoConnector.test({ apiKey: "oauth-access-token" });
    expect(http.calls.map((c) => c.headers.authorization)).toEqual([
      "atelier-lune-1234:s3cr3t-key",
      "Bearer oauth-access-token",
    ]);
  });

  it("names the organization on success", async () => {
    mockFetch(routes());
    expect(await qontoConnector.test(credentials)).toEqual({
      ok: true,
      message: "Connected to Atelier Lune SAS",
    });
  });

  it("maps rejected credentials and outages to user-facing messages", async () => {
    mockFetch(routes({ organization: fail(401, fixtures.unauthorized) }));
    expect((await qontoConnector.test(credentials)).message).toBe(
      "Authentication failed. Check the API token and try again.",
    );

    mockFetch(routes({ organization: fail(503, "Service Unavailable") }));
    const error = await fetchQontoDashboard(credentials).catch((e) => e);
    expect(toUserFacingError(error, "qonto")).toBe(
      "Could not load Qonto data. Try reconnecting the source.",
    );
  });

  it("fails without calling Qonto when no credentials are set", async () => {
    const http = mockFetch(routes());
    const result = await qontoConnector.test({});
    expect(result.ok).toBe(false);
    expect(http.calls).toEqual([]);
  });
});

describe("fetchQontoTransactionsPage", () => {
  // Three transactions share one timestamp across two accounts, straddling
  // the page boundary — the case a timestamp-only cursor would get wrong.
  const feed = [
    tx("tx-m7", MAIN, "2026-09-20T10:00:00.000Z"),
    tx("tx-m6", MAIN, "2026-09-19T10:00:00.000Z"),
    tx("tx-m5", MAIN, "2026-09-18T10:00:00.000Z"),
    tx("tx-c", MAIN, "2026-09-17T12:00:00.000Z"),
    tx("tx-b", MAIN, "2026-09-17T12:00:00.000Z"),
    tx("tx-a", TAX, "2026-09-17T12:00:00.000Z"),
    tx("tx-m2", MAIN, "2026-09-16T10:00:00.000Z"),
    tx("tx-m1", MAIN, "2026-09-15T10:00:00.000Z"),
  ];

  it("merges accounts newest first and hands back a cursor", async () => {
    const http = mockFetch(routes({ transactions: transactionsServer(feed) }));
    const page = await fetchQontoTransactionsPage(credentials, { limit: 5 });

    expect(page.transactions.map((t) => t.id)).toEqual([
      "tx-m7",
      "tx-m6",
      "tx-m5",
      "tx-c",
      "tx-b",
    ]);
    expect(page.transactions[0]).toMatchObject({
      label: "Purchase tx-m7",
      amount: 10,
      side: "debit",
      status: "completed",
      accountName: "Compte principal",
    });
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("2026-09-17T12:00:00.000Z__tx-b");
    // Over-fetches per account so the merge has enough to choose from.
    expect(new URL(http.calls[1].url).searchParams.get("per_page")).toBe("10");
  });

  it("continues from the cursor without repeating or skipping a tie", async () => {
    const http = mockFetch(routes({ transactions: transactionsServer(feed) }));
    const page = await fetchQontoTransactionsPage(credentials, {
      limit: 5,
      cursor: "2026-09-17T12:00:00.000Z__tx-b",
    });

    expect(
      http.callsTo("/v2/transactions").map((c) => new URL(c.url).searchParams.get("settled_at_to")),
    ).toEqual(["2026-09-17T12:00:00.000Z", "2026-09-17T12:00:00.000Z"]);
    expect(page.transactions.map((t) => t.id)).toEqual(["tx-a", "tx-m2", "tx-m1"]);
    expect(page.transactions[0].accountName).toBe("Provision TVA");
    expect(page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("clamps the page size", async () => {
    const http = mockFetch(routes({ transactions: transactionsServer(feed) }));
    await fetchQontoTransactionsPage(credentials, { limit: 1 });
    // At least five rows, fetched twice over.
    expect(new URL(http.calls[1].url).searchParams.get("per_page")).toBe("10");
  });

  it("serves the other accounts, and warns, when one account fails", async () => {
    const server = transactionsServer(feed);
    mockFetch(
      routes({
        transactions: (request) =>
          request.url.includes(MAIN) ? fail(502, "Bad Gateway") : server(request),
      }),
    );
    const page = await fetchQontoTransactionsPage(credentials, { limit: 5 });

    expect(page.transactions.map((t) => t.id)).toEqual(["tx-a"]);
    expect(page.hasMore).toBe(false);
    expect(warnings()).toEqual([
      `[connector:qonto] account transaction page unavailable {"accountId":"${MAIN}"}`,
    ]);
  });

  it("returns an empty, final page for an organization without accounts", async () => {
    mockFetch(
      routes({
        organization: ok({ organization: { name: "Vide", bank_accounts: [] } }),
      }),
    );
    expect(await fetchQontoTransactionsPage(credentials)).toEqual({
      transactions: [],
      nextCursor: null,
      hasMore: false,
    });
  });
});
