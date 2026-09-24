import { afterEach, describe, expect, it, vi } from "vitest";
import fixtures from "./__fixtures__/railway.json";
import {
  fail,
  graphql,
  mockFetch,
  ok,
  setupConnectorTest,
  variablesOf,
  warnings,
  type MockRequest,
  type MockRoute,
} from "./__fixtures__/mock-fetch";
import { toUserFacingError } from "./errors";
import { fetchRailwayDashboard, railwayConnector } from "./railway";

const storefront = fixtures.projects.data.projects.edges[0].node;

/** Deployments for one project, optionally narrowed to a service. */
function deploymentsFor(input: { projectId?: string; serviceId?: string }) {
  if (input.projectId !== "prj_store") return fixtures.deploymentsEmpty;
  const edges = fixtures.deploymentsStorefront.data.deployments.edges.filter(
    (edge) => !input.serviceId || edge.node.serviceId === input.serviceId,
  );
  return { data: { deployments: { edges } } };
}

/** The GraphQL document a request carried. */
function queryOf(request: MockRequest): string {
  const query = (request.body as { query?: unknown } | undefined)?.query;
  return typeof query === "string" ? query : "";
}

type Overrides = Partial<Record<keyof typeof ROUTE_KEYS, MockRoute["respond"]>>;

const ROUTE_KEYS = {
  projectToken: /\bprojectToken\b/,
  apiToken: /\bapiToken\b/,
  // The full project query and the name lookup share `project(id: $id)`.
  projectDetail: /project\(id: \$id\) \{\s*id/,
  projectName: /project\(id: \$id\) \{ name \}/,
  projects: /projects\(workspaceId/,
  deployments: /deployments\(input/,
  metricsGrouped: /groupBy: \$groupBy/,
  metricsSeries: /sampleRateSeconds: \$sampleRateSeconds/,
  metricsAggregate: /metrics\(/,
  usage: /estimatedUsage/,
  billingWorkspace: /workspace\(workspaceId/,
  billingMe: /me \{\s*workspaces/,
  me: /me \{ name email \}/,
} as const;

/** A personal account token that can see two projects, one without services. */
function accountRoutes(overrides: Overrides = {}): MockRoute[] {
  const defaults: Record<keyof typeof ROUTE_KEYS, MockRoute["respond"]> = {
    projectToken: ok(fixtures.notAuthorized),
    apiToken: ok(fixtures.notAuthorized),
    projectDetail: ok({ data: { project: storefront } }),
    projectName: ok(fixtures.projectName),
    projects: ok(fixtures.projects),
    deployments: (request) =>
      ok(deploymentsFor(variablesOf(request).input as { projectId?: string })),
    metricsGrouped: (request) =>
      ok(
        variablesOf(request).environmentId === "env_prod"
          ? fixtures.metricsByService
          : fixtures.metricsEmpty,
      ),
    metricsSeries: ok(fixtures.metricsSeries),
    metricsAggregate: ok(fixtures.metricsEmpty),
    usage: (request) =>
      ok(
        variablesOf(request).projectId === "prj_store"
          ? fixtures.usageStorefront
          : fixtures.usageDocs,
      ),
    billingWorkspace: ok(fixtures.billingWorkspace),
    billingMe: ok(fixtures.billingMe),
    me: ok(fixtures.me),
  };
  return (Object.keys(ROUTE_KEYS) as Array<keyof typeof ROUTE_KEYS>).map(
    (key) => graphql(ROUTE_KEYS[key], overrides[key] ?? defaults[key]),
  );
}

setupConnectorTest("2026-09-20T12:00:00.000Z");

describe("fetchRailwayDashboard — account token", () => {
  it("builds services, deploy health and fleet from the project list", async () => {
    const http = mockFetch(accountRoutes());
    const dash = await fetchRailwayDashboard("  acct-token  ");

    expect(http.unmatched).toEqual([]);
    // A personal token goes out as a bearer token, trimmed.
    expect(http.calls.at(-1)?.headers.authorization).toBe("Bearer acct-token");

    expect(dash.items).toEqual([
      {
        id: "svc_api",
        name: "storefront / api",
        provider: "railway",
        status: "warn",
        detail: "2 behind live",
        updatedAt: "2026-09-18T10:00:00.000Z",
      },
      {
        id: "svc_worker",
        name: "storefront / worker",
        provider: "railway",
        status: "error",
        detail: "Live crashed",
        updatedAt: "2026-09-20T07:30:00.000Z",
      },
    ]);

    expect(dash.fleet).toEqual({
      healthy: 0,
      total: 2,
      crashed: 1,
      sleeping: 0,
      degraded: 1,
    });

    // A crashed live deploy outranks a healthy one with failures on top.
    expect(dash.deployHealth).toMatchObject({
      serviceId: "svc_worker",
      active: { status: "crashed", label: "Process refunds in batches" },
      behindCount: 0,
    });
  });

  it("counts failed attempts sitting above the live deploy", async () => {
    mockFetch(accountRoutes());
    const dash = await fetchRailwayDashboard("acct-token");

    expect(dash.trackers.svc_api.map((p) => p.status)).toEqual([
      "ok",
      "warn",
      "warn",
    ]);
    expect(dash.trackers.svc_worker.map((p) => p.status)).toEqual([
      "idle",
      "error",
    ]);

    const api = dash.recentDeploys.filter((d) => d.serviceId === "svc_api");
    expect(api.map((d) => [d.id, d.stage])).toEqual([
      ["dep_api_3", "Build failed"],
      ["dep_api_2", "Healthcheck failed"],
      ["dep_api_1", "Running"],
    ]);
    // Only the first line of the commit message, and a short hash.
    expect(api[0]).toMatchObject({
      label: "Bump prisma to 6.2",
      commitHash: "a1b2c3d",
      branch: "main",
    });
  });

  it("keeps deploys of services no longer listed, newest first", async () => {
    mockFetch(accountRoutes());
    const dash = await fetchRailwayDashboard("acct-token");

    expect(dash.recentDeploys.map((d) => d.id)).toEqual([
      "dep_api_3",
      "dep_wrk_2",
      "dep_api_2",
      "dep_api_1",
      "dep_wrk_1",
      "dep_gone",
    ]);
    expect(dash.recentDeploys.at(-1)).toMatchObject({
      serviceName: "Service",
      projectName: "storefront",
    });
  });

  it("summarises each project by its worst service", async () => {
    mockFetch(accountRoutes());
    const dash = await fetchRailwayDashboard("acct-token");

    expect(dash.projects).toEqual([
      {
        id: "prj_store",
        name: "storefront",
        serviceCount: 2,
        healthy: 0,
        failed: 2,
        status: "error",
        detail: "2 services · 2 failing",
        updatedAt: "2026-09-20T09:00:00.000Z",
      },
      {
        id: "prj_docs",
        name: "docs",
        serviceCount: 0,
        healthy: 0,
        failed: 0,
        status: "idle",
        detail: "No services",
        updatedAt: undefined,
      },
    ]);
  });

  it("reads resources, usage, series and billing", async () => {
    mockFetch(accountRoutes());
    const dash = await fetchRailwayDashboard("acct-token");

    // Latest finite value per series: api 0.12 and worker 0.3 (its newest is null).
    expect(dash.resources.cpuCores).toBeCloseTo(0.21, 10);
    expect(dash.resources).toMatchObject({
      memoryGb: 0.5,
      sampledServices: 2,
      label: "Avg · last hour · 2 series",
    });

    // Summed across both projects.
    expect(dash.usage).toEqual([
      { measurement: "CPU_USAGE", value: 13, label: "CPU", display: "13.0 vCPU·h" },
      { measurement: "MEMORY_USAGE_GB", value: 3.25, label: "Memory", display: "3.25 GB" },
      { measurement: "NETWORK_TX_GB", value: 0.8, label: "Egress", display: "0.80 GB" },
      { measurement: "DISK_USAGE_GB", value: 1, label: "Disk", display: "1.00 GB" },
    ]);

    expect(dash.metrics?.projectName).toBe("storefront");
    expect(dash.metrics?.environmentName).toBe("production");
    expect(dash.metrics?.hours).toBe(24);
    // An empty series is dropped rather than charted flat.
    expect(dash.metrics?.series.map((s) => s.key)).toEqual([
      "cpu",
      "memory",
      "egress",
    ]);
    const cpu = dash.metrics?.series[0];
    expect(cpu?.points.map((p) => [p.ts, p.value])).toEqual([
      ["2026-09-20T10:30:00.000Z", 0.1],
      ["2026-09-20T10:45:00.000Z", 0.4],
      ["2026-09-20T11:45:00.000Z", 0.25],
    ]);
    expect(cpu).toMatchObject({ latest: 0.25, peak: 0.4, average: 0.25 });

    // Picked from the workspace that has billing attached; the invoice is in cents.
    expect(dash.billing).toEqual({
      workspaceName: "Acme",
      plan: "PRO",
      currency: "usd",
      estimatedBill: 25.99,
      currentUsage: 18.42,
      creditBalance: 5,
      cycleStart: "2026-09-01T00:00:00.000Z",
      cycleEnd: "2026-10-01T00:00:00.000Z",
      nextInvoiceDate: "2026-10-01T00:00:00.000Z",
    });
  });

  it("is what the connector's fetchDashboard returns", async () => {
    mockFetch(accountRoutes());
    const viaConnector = await railwayConnector.fetchDashboard({
      apiKey: "acct-token",
    });
    expect(viaConnector.items.map((i) => i.id)).toEqual(["svc_api", "svc_worker"]);
  });

  it("renders an empty account without inventing anything", async () => {
    mockFetch(
      accountRoutes({
        projects: ok({ data: { projects: { edges: [] } } }),
        usage: ok({ data: { estimatedUsage: [] } }),
        billingMe: ok({ data: { me: { workspaces: [] } } }),
      }),
    );
    const dash = await fetchRailwayDashboard("acct-token");

    expect(dash).toEqual({
      items: [],
      trackers: {},
      deployHealth: null,
      fleet: { healthy: 0, total: 0, crashed: 0, sleeping: 0, degraded: 0 },
      recentDeploys: [],
      resources: {
        cpuCores: null,
        memoryGb: null,
        sampledServices: 0,
        label: "No metrics in the last hour",
      },
      usage: [],
      projects: [],
      metrics: null,
      billing: null,
    });
  });
});

describe("fetchRailwayDashboard — partial failures", () => {
  it("falls back to the environment aggregate when grouped metrics fail", async () => {
    const http = mockFetch(
      accountRoutes({
        metricsGrouped: fail(400, { errors: [{ message: "bad groupBy" }] }),
        metricsAggregate: (request) =>
          ok(
            variablesOf(request).environmentId === "env_prod"
              ? fixtures.metricsByService
              : fixtures.metricsEmpty,
          ),
      }),
    );
    const dash = await fetchRailwayDashboard("acct-token");

    expect(http.unmatched).toEqual([]);
    expect(dash.resources.sampledServices).toBe(2);
  });

  it("drops only the section whose request failed", async () => {
    mockFetch(
      accountRoutes({
        metricsGrouped: fail(500),
        metricsAggregate: fail(500),
        metricsSeries: fail(502, "Bad Gateway"),
        usage: fail(403, { errors: [{ message: "Forbidden" }] }),
        billingMe: ok({
          data: null,
          errors: [{ message: "Not Authorized", path: ["me", "workspaces"] }],
        }),
      }),
    );
    const dash = await fetchRailwayDashboard("acct-token");

    expect(dash.items).toHaveLength(2);
    expect(dash.resources.label).toBe("No metrics in the last hour");
    expect(dash.metrics).toBeNull();
    expect(dash.usage).toEqual([]);
    expect(dash.billing).toBeNull();
  });

  it("keeps the data GraphQL did resolve alongside a field error", async () => {
    mockFetch(
      accountRoutes({
        projects: ok({
          ...fixtures.projects,
          errors: [
            { message: "Not Authorized", path: ["projects", "edges", 2, "node"] },
          ],
        }),
      }),
    );
    const dash = await fetchRailwayDashboard("acct-token");

    expect(dash.projects.map((p) => p.name)).toEqual(["storefront", "docs"]);
  });

  it("asks per service when the project-wide deploy list fails", async () => {
    const http = mockFetch(
      accountRoutes({
        deployments: (request) => {
          const input = variablesOf(request).input as {
            projectId?: string;
            serviceId?: string;
          };
          if (!input.serviceId) return fail(500, "upstream timeout");
          return ok(deploymentsFor(input));
        },
      }),
    );
    const dash = await fetchRailwayDashboard("acct-token");

    const perService = http.calls.filter(
      (call) =>
        (variablesOf(call).input as { serviceId?: string } | undefined)
          ?.serviceId,
    );
    expect(perService).toHaveLength(2);
    expect(dash.items.map((i) => i.detail)).toEqual([
      "2 behind live",
      "Live crashed",
    ]);
    // The orphaned deploy only ever came from the project-wide list.
    expect(dash.recentDeploys.map((d) => d.id)).not.toContain("dep_gone");
  });
});

describe("fetchRailwayDashboard — fallback logging", () => {
  afterEach(() => {
    delete process.env.BUSSOLA_LOG_LEVEL;
  });

  it("leaves a warning when a section goes blank", async () => {
    mockFetch(accountRoutes({ metricsSeries: fail(502, "Bad Gateway") }));
    await fetchRailwayDashboard("acct-token");

    expect(warnings()).toEqual([
      '[connector:railway] metric series unavailable {"environmentId":"env_prod"}',
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: "Railway API 502: Bad Gateway" }),
    );
  });

  it("never writes the token, even at debug level", async () => {
    process.env.BUSSOLA_LOG_LEVEL = "debug";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const secret = "rw_secret_7f3a9c";
    mockFetch(
      accountRoutes({
        metricsGrouped: fail(400),
        metricsAggregate: fail(500),
        metricsSeries: fail(502),
        usage: fail(403),
        billingMe: fail(500),
      }),
    );
    await fetchRailwayDashboard(secret);

    const written = [...logSpy.mock.calls, ...vi.mocked(console.warn).mock.calls]
      .map((args) =>
        args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" "),
      )
      .join("\n");
    // Debug lines for the expected probes, warnings for blanked sections.
    expect(written).toContain("not a project token");
    expect(written).toContain("environment metrics unavailable");
    expect(written).not.toContain(secret);
  });
});

describe("fetchRailwayDashboard — other token kinds", () => {
  it("scopes a project token to its one project and environment", async () => {
    const http = mockFetch(
      accountRoutes({
        projectToken: ok(fixtures.projectToken),
      }),
    );
    const dash = await fetchRailwayDashboard("proj-token");

    expect(http.unmatched).toEqual([]);
    expect(http.calls[0].headers["project-access-token"]).toBe("proj-token");
    expect(http.calls[0].headers.authorization).toBeUndefined();
    expect(dash.projects.map((p) => p.id)).toEqual(["prj_store"]);
    // Billing lives on a workspace, which a project token cannot see.
    expect(dash.billing).toBeNull();
    expect(
      http.calls.some((call) => ROUTE_KEYS.billingMe.test(queryOf(call))),
    ).toBe(false);
  });

  it("scopes a workspace token's project list and billing to its workspace", async () => {
    const http = mockFetch(accountRoutes({ apiToken: ok(fixtures.apiToken) }));
    const dash = await fetchRailwayDashboard("ws-token");

    const projectsCall = http.calls.find((call) =>
      ROUTE_KEYS.projects.test(queryOf(call)),
    );
    expect(projectsCall && variablesOf(projectsCall)).toEqual({
      workspaceId: "ws_acme",
    });
    expect(dash.billing).toMatchObject({ workspaceName: "Acme", estimatedBill: 12.5 });
  });
});

describe("railwayConnector.test", () => {
  it("names the project a project token belongs to", async () => {
    mockFetch(accountRoutes({ projectToken: ok(fixtures.projectToken) }));
    const result = await railwayConnector.test({ apiKey: "proj-token" });
    expect(result).toMatchObject({
      ok: true,
      message: "Connected to project “storefront”",
      meta: { mode: "project", projectId: "prj_store", environmentId: "env_prod" },
    });
  });

  it("names the workspace a workspace token belongs to", async () => {
    mockFetch(accountRoutes({ apiToken: ok(fixtures.apiToken) }));
    const result = await railwayConnector.test({ apiKey: "ws-token" });
    expect(result).toMatchObject({ ok: true, message: "Connected as Acme" });
  });

  it("names the person behind a personal token", async () => {
    mockFetch(accountRoutes());
    const result = await railwayConnector.test({ apiKey: "acct-token" });
    expect(result).toMatchObject({ ok: true, message: "Connected as Ada Lovelace" });
  });

  it("explains a token no identity query accepts", async () => {
    mockFetch(accountRoutes({ me: ok(fixtures.notAuthorized) }));
    const result = await railwayConnector.test({ apiKey: "revoked" });
    expect(result).toEqual({
      ok: false,
      message:
        "Railway rejected this token. Create a new account token (Account → Tokens) and reconnect.",
    });
  });

  it("maps a rate limit to a retry hint rather than a bad-token message", async () => {
    mockFetch([graphql(/./, fail(429, "Too Many Requests"))]);
    const result = await railwayConnector.test({ apiKey: "acct-token" });
    expect(result.message).toBe("Provider rate limit hit. Try again in a moment.");
  });

  it("asks for a token before calling Railway", async () => {
    const http = mockFetch([]);
    const result = await railwayConnector.test({ apiKey: "   " });
    expect(result).toEqual({ ok: false, message: "API token required" });
    expect(http.calls).toEqual([]);
  });

  it("fails the dashboard with the same user-facing message", async () => {
    mockFetch(accountRoutes({ me: fail(401, { message: "Unauthorized" }) }));
    const error = await fetchRailwayDashboard("revoked").catch((e) => e);
    expect(toUserFacingError(error, "railway")).toMatch(/^Railway rejected this token/);
  });
});
