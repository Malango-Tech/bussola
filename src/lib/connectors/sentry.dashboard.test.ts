import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/sentry.json";
import {
  fail,
  mockFetch,
  ok,
  setupConnectorTest,
  type MockRoute,
} from "./__fixtures__/mock-fetch";
import { toUserFacingError } from "./errors";
import { fetchSentryDashboard, sentryConnector } from "./sentry";

setupConnectorTest("2026-09-20T12:00:00.000Z");

const credentials = { apiKey: "sntryu_token" };

type Overrides = Partial<
  Record<"organizations" | "issues" | "projects", MockRoute["respond"]>
>;

function routes(overrides: Overrides = {}): MockRoute[] {
  return [
    {
      match: /\/api\/0\/organizations\/$/,
      respond: overrides.organizations ?? ok(fixtures.organizations),
    },
    { match: "/issues/?", respond: overrides.issues ?? ok(fixtures.issues) },
    { match: "/projects/", respond: overrides.projects ?? ok(fixtures.projects) },
  ];
}

describe("fetchSentryDashboard", () => {
  it("lists unresolved issues and project health for the token's organization", async () => {
    const http = mockFetch(routes());
    const dash = await sentryConnector.fetchDashboard(credentials);

    expect(http.unmatched).toEqual([]);
    expect(http.calls.map((c) => c.url)).toEqual([
      "https://sentry.io/api/0/organizations/",
      "https://sentry.io/api/0/organizations/acme/issues/?query=is%3Aunresolved&statsPeriod=24h&limit=25",
      "https://sentry.io/api/0/organizations/acme/projects/",
    ]);

    expect(dash.organizationName).toBe("Acme Inc");
    expect(dash.unresolved).toBe(3);
    // Counts arrive as strings on this endpoint, and as numbers elsewhere.
    expect(dash.events24h).toBe(1523 + 12 + 3);
    expect(dash.truncated).toBe(false);

    expect(dash.issues).toEqual([
      {
        id: "4501238811",
        title: "TypeError: Cannot read properties of undefined (reading 'id')",
        culprit: "app/api/orders/route.ts in GET",
        level: "error",
        status: "error",
        count: 1523,
        userCount: 87,
        lastSeen: "2026-09-20T11:48:00.000000Z",
        projectName: "api",
        permalink: "https://acme.sentry.io/issues/4501238811/",
      },
      {
        id: "4501238790",
        title: "Job exceeded soft timeout",
        culprit: "jobs/refunds.processBatch",
        level: "warning",
        status: "warn",
        count: 12,
        userCount: 0,
        lastSeen: "2026-09-20T09:10:00.000000Z",
        // No project name in the payload: the slug stands in.
        projectName: "worker",
        permalink: "https://acme.sentry.io/issues/4501238790/",
      },
      {
        id: "4501238702",
        title: "OOMKilled",
        culprit: undefined,
        level: "fatal",
        status: "error",
        count: 3,
        userCount: 3,
        lastSeen: "2026-09-20T07:00:00.000000Z",
        projectName: "api",
        permalink: undefined,
      },
    ]);

    expect(dash.projects.map((p) => [p.name, p.status, p.detail])).toEqual([
      ["api", "ok", "Receiving events"],
      // Set up but never reported: not the same as healthy.
      ["worker", "idle", "No events yet"],
      ["legacy-web", "warn", "Receiving events"],
    ]);
    expect(dash.projects[0]).toEqual({
      id: "4507000000000011",
      name: "api",
      provider: "sentry",
      status: "ok",
      detail: "Receiving events",
    });
  });

  it("uses a configured organization slug without looking it up", async () => {
    const http = mockFetch(routes());
    const dash = await fetchSentryDashboard({ ...credentials, orgSlug: " acme-eu " });

    expect(http.callsTo("/organizations/acme-eu/issues/")).toHaveLength(1);
    expect(http.calls.some((c) => c.url.endsWith("/organizations/"))).toBe(false);
    expect(dash.organizationName).toBe("acme-eu");
  });

  it("flags a full page of issues as a partial count", async () => {
    const page = Array.from({ length: 25 }, (_, i) => ({
      ...fixtures.issues[0],
      id: String(9000 + i),
    }));
    mockFetch(routes({ issues: ok(page) }));
    const dash = await fetchSentryDashboard(credentials);

    expect(dash.unresolved).toBe(25);
    expect(dash.truncated).toBe(true);
  });

  it("keeps the issue list when projects are out of the token's scope", async () => {
    mockFetch(routes({ projects: fail(403, fixtures.forbidden) }));
    const dash = await fetchSentryDashboard(credentials);

    expect(dash.projects).toEqual([]);
    expect(dash.issues).toHaveLength(3);
  });

  it("renders an organization with nothing unresolved", async () => {
    mockFetch(routes({ issues: ok([]), projects: ok([]) }));
    expect(await fetchSentryDashboard(credentials)).toEqual({
      organizationName: "Acme Inc",
      unresolved: 0,
      events24h: 0,
      issues: [],
      projects: [],
      truncated: false,
    });
  });

  it("fails as a whole when issues cannot be read", async () => {
    mockFetch(routes({ issues: fail(403, fixtures.forbidden) }));
    const error = await fetchSentryDashboard(credentials).catch((e) => e);
    expect(toUserFacingError(error, "sentry")).toBe(
      "Access denied. This token may lack the required permissions.",
    );
  });
});

describe("sentryConnector.test", () => {
  it("names the organization", async () => {
    mockFetch(routes());
    expect(await sentryConnector.test(credentials)).toEqual({
      ok: true,
      message: "Connected to Acme Inc",
    });
  });

  it("maps an invalid token", async () => {
    mockFetch(routes({ organizations: fail(401, fixtures.invalidToken) }));
    expect(await sentryConnector.test(credentials)).toEqual({
      ok: false,
      message: "Invalid API token. Check the key and try again.",
    });
  });

  it("fails a token that can see no organization", async () => {
    mockFetch(routes({ organizations: ok([]) }));
    const result = await sentryConnector.test(credentials);
    expect(result.ok).toBe(false);
  });
});
