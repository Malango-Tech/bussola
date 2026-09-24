import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/netlify.json";
import {
  fail,
  mockFetch,
  ok,
  setupConnectorTest,
  warnings,
  type MockRoute,
} from "./__fixtures__/mock-fetch";
import { toUserFacingError } from "./errors";
import { fetchNetlifyDashboard, netlifyConnector } from "./netlify";

setupConnectorTest("2026-09-20T12:00:00.000Z");

const [marketing, docs, playground] = fixtures.sites;

type Overrides = Partial<
  Record<
    "sites" | "docsDeploys" | "accounts" | "buildStatus" | "marketingForms",
    MockRoute["respond"]
  >
>;

function routes(overrides: Overrides = {}): MockRoute[] {
  return [
    { match: "/api/v1/sites?per_page=", respond: overrides.sites ?? ok(fixtures.sites) },
    { match: `/sites/${marketing.id}/deploys`, respond: ok(fixtures.deploysMarketing) },
    {
      match: `/sites/${docs.id}/deploys`,
      respond: overrides.docsDeploys ?? ok(fixtures.deploysDocs),
    },
    { match: `/sites/${playground.id}/deploys`, respond: ok([]) },
    {
      match: `/sites/${marketing.id}/forms`,
      respond: overrides.marketingForms ?? ok(fixtures.formsMarketing),
    },
    { match: `/sites/${docs.id}/forms`, respond: ok([]) },
    // Forms turned off for this site.
    {
      match: `/sites/${playground.id}/forms`,
      respond: fail(404, { code: 404, message: "Not Found" }),
    },
    { match: "/api/v1/accounts", respond: overrides.accounts ?? ok(fixtures.accounts) },
    { match: "/builds/status", respond: overrides.buildStatus ?? ok(fixtures.buildStatus) },
  ];
}

describe("fetchNetlifyDashboard", () => {
  it("builds a row and a deploy trail per site", async () => {
    const http = mockFetch(routes());
    const dash = await netlifyConnector.fetchDashboard({ apiKey: " nfp_token " });

    expect(http.unmatched).toEqual([]);
    expect(http.calls[0].headers.authorization).toBe("Bearer nfp_token");

    expect(dash.items).toEqual([
      {
        id: marketing.id,
        name: "acme-marketing",
        provider: "netlify",
        status: "ok",
        detail: "3 deploys · 1 issues · ready",
        updatedAt: "2026-09-19T15:58:00.000Z",
      },
      {
        id: docs.id,
        name: "acme-docs",
        provider: "netlify",
        status: "error",
        detail: "2 deploys · 2 issues · building",
        updatedAt: "2026-09-20T10:00:00.000Z",
      },
      {
        // No published deploy and no history: set up, never shipped.
        id: playground.id,
        name: "playground",
        provider: "netlify",
        status: "idle",
        detail: "No deploys yet",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
    expect(dash.healthy).toBe(1);
    expect(dash.total).toBe(3);

    // Oldest → newest, read left to right.
    expect(dash.trackers[marketing.id].map((p) => [p.status, p.tooltip])).toEqual([
      ["ok", "ready · main"],
      ["error", "error · main"],
      ["ok", "ready · main"],
    ]);
    expect(dash.trackers[playground.id]).toEqual([]);
  });

  it("merges every site's deploys newest first", async () => {
    mockFetch(routes());
    const dash = await fetchNetlifyDashboard("nfp_token");

    expect(dash.recentDeploys.map((d) => [d.siteName, d.rawState, d.createdAt])).toEqual([
      ["acme-docs", "building", "2026-09-20T11:30:00.000Z"],
      ["acme-docs", "error", "2026-09-20T10:00:00.000Z"],
      ["acme-marketing", "ready", "2026-09-19T15:58:00.000Z"],
      ["acme-marketing", "error", "2026-09-18T11:00:00.000Z"],
      ["acme-marketing", "ready", "2026-09-17T09:00:00.000Z"],
    ]);
    expect(dash.recentDeploys[0]).toMatchObject({ status: "warn", branch: "fix/sidebar" });
  });

  it("ranks forms by submissions and reads build minutes for the site's account", async () => {
    const http = mockFetch(routes());
    const dash = await fetchNetlifyDashboard("nfp_token");

    expect(dash.forms).toEqual([
      {
        id: "5f1a2b3c4d5e6f7a8b9c0d1f",
        name: "contact",
        siteName: "acme-marketing",
        submissionCount: 42,
      },
      {
        id: "5f1a2b3c4d5e6f7a8b9c0d1e",
        name: "newsletter",
        siteName: "acme-marketing",
        submissionCount: 7,
      },
    ]);
    expect(dash.formSubmissionsTotal).toBe(49);

    // The site names its account by slug; the account list resolves it to an id.
    expect(http.callsTo("/builds/status")[0].url).toBe(
      "https://api.netlify.com/api/v1/5a8b0c1d2e3f405162738495/builds/status",
    );
    expect(dash.buildMinutes).toEqual({
      current: 270,
      previous: 225,
      deltaPct: 20,
      active: 1,
      enqueued: 2,
      label: "1 building · 2 queued",
    });
  });

  it("falls back to the published deploy when a site's history fails", async () => {
    mockFetch(routes({ docsDeploys: fail(500, "Internal Server Error") }));
    const dash = await fetchNetlifyDashboard("nfp_token");

    const row = dash.items.find((i) => i.id === docs.id);
    expect(row).toMatchObject({ status: "error", detail: "Latest · error" });
    expect(dash.trackers[docs.id]).toEqual([
      { key: "published", color: "bg-destructive", tooltip: "acme-docs: error", status: "error" },
    ]);
    expect(dash.recentDeploys.every((d) => d.siteId !== docs.id)).toBe(true);
    expect(warnings()).toEqual([
      `[connector:netlify] site deploys unavailable {"siteId":"${docs.id}"}`,
    ]);
  });

  it("uses the site's account slug when the account list is unavailable", async () => {
    const http = mockFetch(routes({ accounts: fail(403, { code: 403, message: "Forbidden" }) }));
    const dash = await fetchNetlifyDashboard("nfp_token");

    expect(http.callsTo("/builds/status")[0].url).toBe(
      "https://api.netlify.com/api/v1/acme/builds/status",
    );
    expect(dash.buildMinutes?.current).toBe(270);
  });

  it("leaves build minutes and forms empty when those endpoints fail", async () => {
    mockFetch(
      routes({
        buildStatus: fail(403, { code: 403, message: "Forbidden" }),
        marketingForms: fail(500, "oops"),
      }),
    );
    const dash = await fetchNetlifyDashboard("nfp_token");

    expect(dash.buildMinutes).toBeNull();
    expect(dash.forms).toEqual([]);
    expect(dash.items).toHaveLength(3);
    // Both are optional extras: logged at debug, not warn.
    expect(warnings()).toEqual([]);
  });

  it("renders an account with no sites", async () => {
    mockFetch(routes({ sites: ok([]), accounts: ok([]) }));
    const dash = await fetchNetlifyDashboard("nfp_token");

    expect(dash).toEqual({
      items: [],
      trackers: {},
      healthy: 0,
      total: 0,
      recentDeploys: [],
      buildMinutes: null,
      forms: [],
      formSubmissionsTotal: 0,
    });
  });

  it("fails as a whole when the token is rejected", async () => {
    mockFetch(routes({ sites: fail(401, fixtures.unauthorized) }));
    const error = await fetchNetlifyDashboard("expired").catch((e) => e);
    // Netlify's body says "Invalid token", which reads better than the status.
    expect(toUserFacingError(error, "netlify")).toBe(
      "Invalid API token. Check the key and try again.",
    );
  });
});

describe("netlifyConnector.test", () => {
  it("connects when sites are readable", async () => {
    const http = mockFetch(routes());
    expect(await netlifyConnector.test({ apiKey: "nfp_token" })).toEqual({
      ok: true,
      message: "Connected — sites accessible",
    });
    expect(http.calls[0].url).toBe("https://api.netlify.com/api/v1/sites?per_page=1");
  });

  it("connects an account with no sites", async () => {
    mockFetch(routes({ sites: ok([]) }));
    expect((await netlifyConnector.test({ apiKey: "nfp_token" })).message).toBe(
      "Connected — no sites yet",
    );
  });

  it("maps a provider outage to the Netlify fallback message", async () => {
    mockFetch(routes({ sites: fail(503, "<html>Service Unavailable</html>") }));
    expect(await netlifyConnector.test({ apiKey: "nfp_token" })).toEqual({
      ok: false,
      message: "Could not load Netlify data. Try reconnecting the source.",
    });
  });

  it("asks for a token before calling out", async () => {
    expect(await netlifyConnector.test({ apiKey: "" })).toEqual({
      ok: false,
      message: "Personal access token required",
    });
  });
});
