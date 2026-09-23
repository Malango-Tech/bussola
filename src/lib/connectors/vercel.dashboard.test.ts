import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/vercel.json";
import {
  fail,
  mockFetch,
  ok,
  setupConnectorTest,
  type MockRoute,
} from "./__fixtures__/mock-fetch";
import { toUserFacingError } from "./errors";
import { fetchVercelDashboard, vercelConnector } from "./vercel";

setupConnectorTest("2026-09-20T12:00:00.000Z");

const credentials = { apiKey: "vcp_token" };

function routes(
  overrides: { projects?: MockRoute["respond"]; deployments?: MockRoute["respond"] } = {},
): MockRoute[] {
  return [
    { match: "/v9/projects?", respond: overrides.projects ?? ok(fixtures.projects) },
    { match: "/v6/deployments?", respond: overrides.deployments ?? ok(fixtures.deployments) },
  ];
}

describe("fetchVercelDashboard", () => {
  it("rates each project by its newest deployment", async () => {
    const http = mockFetch(routes());
    const dash = await vercelConnector.fetchDashboard(credentials);

    expect(http.unmatched).toEqual([]);
    expect(http.calls[0].headers.authorization).toBe("Bearer vcp_token");
    expect(dash.items).toEqual([
      {
        id: "prj_web8Qm2",
        name: "web",
        provider: "vercel",
        status: "ok",
        detail: "Ready",
        updatedAt: "2026-09-20T11:00:00.000Z",
      },
      {
        id: "prj_docsL4k",
        name: "docs",
        provider: "vercel",
        status: "warn",
        detail: "Building",
        updatedAt: "2026-09-20T11:50:00.000Z",
      },
      {
        id: "prj_sbx91Z",
        name: "sandbox",
        provider: "vercel",
        status: "idle",
        detail: "No deployments",
        updatedAt: undefined,
      },
    ]);
    expect(dash.ready).toBe(1);
    expect(dash.total).toBe(3);

    // Vercel lists newest first; the trail reads oldest → newest.
    expect(dash.trackers.web.map((p) => [p.key, p.status, p.color])).toEqual([
      ["dpl_5vH0webError", "error", "bg-destructive"],
      ["dpl_6wJ1webReady", "ok", "bg-success"],
    ]);
    expect(dash.trackers.sandbox).toEqual([]);
  });

  it("lists recent deployments with their git context", async () => {
    mockFetch(routes());
    const dash = await fetchVercelDashboard(credentials);

    expect(dash.recentDeploys).toEqual([
      {
        id: "dpl_7xK2docsBuilding",
        projectName: "docs",
        status: "warn",
        rawState: "Building",
        target: "production",
        branch: "main",
        commitMessage: "Document the refund flow",
        createdAt: "2026-09-20T11:50:00.000Z",
        url: "docs-git-main-acme.vercel.app",
      },
      {
        id: "dpl_6wJ1webReady",
        projectName: "web",
        status: "ok",
        rawState: "Ready",
        target: "production",
        branch: "main",
        commitMessage: "Fix checkout rounding",
        createdAt: "2026-09-20T11:00:00.000Z",
        url: "web-3kd8s-acme.vercel.app",
      },
      {
        // A preview: `target` is null, reported as absent.
        id: "dpl_5vH0webError",
        projectName: "web",
        status: "error",
        rawState: "Error",
        target: undefined,
        branch: "feat/bundler",
        commitMessage: "Try the new bundler",
        createdAt: "2026-09-20T10:00:00.000Z",
        url: "web-2jd7r-acme.vercel.app",
      },
      {
        // A project since deleted still shows in the deploy list.
        id: "dpl_4uG9orphan",
        projectName: "old-landing",
        status: "idle",
        rawState: "Canceled",
        target: "production",
        branch: undefined,
        commitMessage: undefined,
        createdAt: "2026-09-19T10:00:00.000Z",
        url: "old-landing-acme.vercel.app",
      },
    ]);
  });

  it("scopes both requests to the configured team", async () => {
    const http = mockFetch(routes());
    await fetchVercelDashboard({ ...credentials, orgSlug: " team_acme " });

    expect(http.calls.map((c) => c.url)).toEqual([
      "https://api.vercel.com/v9/projects?limit=20&teamId=team_acme",
      "https://api.vercel.com/v6/deployments?limit=30&teamId=team_acme",
    ]);
  });

  it("renders an account with no projects", async () => {
    mockFetch(routes({ projects: ok({ projects: [] }), deployments: ok({ deployments: [] }) }));
    expect(await fetchVercelDashboard(credentials)).toEqual({
      items: [],
      trackers: {},
      ready: 0,
      total: 0,
      recentDeploys: [],
    });
  });

  it("fails as a whole when deployments cannot be read", async () => {
    // Projects without deployments would all read "No deployments" — worse
    // than an honest error — so there is no partial fallback here.
    mockFetch(routes({ deployments: fail(403, fixtures.forbidden) }));
    const error = await fetchVercelDashboard(credentials).catch((e) => e);
    expect(toUserFacingError(error, "vercel")).toBe(
      "Access denied. This token may lack the required permissions.",
    );
  });

  it("refuses to call Vercel without a token", async () => {
    await expect(fetchVercelDashboard({})).rejects.toThrow(
      "Vercel API token is required",
    );
  });
});

describe("vercelConnector.test", () => {
  it("connects with one cheap project read", async () => {
    const http = mockFetch(routes());
    expect(await vercelConnector.test({ ...credentials, orgSlug: "team_acme" })).toEqual({
      ok: true,
      message: "Connected to Vercel",
    });
    expect(http.calls.map((c) => c.url)).toEqual([
      "https://api.vercel.com/v9/projects?limit=1&teamId=team_acme",
    ]);
  });

  it("connects an account with no projects", async () => {
    mockFetch(routes({ projects: ok({ projects: [] }) }));
    expect((await vercelConnector.test(credentials)).message).toBe(
      "Connected — no projects found",
    );
  });

  it("maps a missing or revoked token", async () => {
    mockFetch(routes({ projects: fail(403, fixtures.invalidToken) }));
    expect(await vercelConnector.test(credentials)).toEqual({
      ok: false,
      message: "Authentication failed. Check the API token and try again.",
    });
  });
});
