import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/supabase.json";
import {
  fail,
  mockFetch,
  ok,
  setupConnectorTest,
  warnings,
  type MockRoute,
} from "./__fixtures__/mock-fetch";
import { toUserFacingError } from "./errors";
import { fetchSupabaseDashboard, supabaseConnector } from "./supabase";

setupConnectorTest("2026-09-20T12:00:00.000Z");

const PROD = "abcdefghijklmnopqrst";
const STAGING = "zyxwvutsrqponmlkjihg";
const TOKEN = "sbp_0123456789abcdef";

type Overrides = Partial<
  Record<
    | "projects"
    | "prodHealth"
    | "prodUsage"
    | "prodSecurity"
    | "prodPerformance",
    MockRoute["respond"]
  >
>;

function routes(overrides: Overrides = {}): MockRoute[] {
  return [
    { match: /\/v1\/projects$/, respond: overrides.projects ?? ok(fixtures.projects) },
    { match: `/projects/${PROD}/health`, respond: overrides.prodHealth ?? ok(fixtures.healthProd) },
    { match: `/projects/${STAGING}/health`, respond: ok(fixtures.healthStaging) },
    { match: `/projects/${PROD}/functions`, respond: ok(fixtures.functionsProd) },
    { match: `/projects/${STAGING}/functions`, respond: ok([]) },
    {
      match: `/projects/${PROD}/analytics`,
      respond: overrides.prodUsage ?? ok(fixtures.usageProd),
    },
    { match: `/projects/${STAGING}/analytics`, respond: ok(fixtures.usageEmpty) },
    {
      match: `/projects/${PROD}/advisors/security`,
      respond: overrides.prodSecurity ?? ok(fixtures.advisorsSecurityProd),
    },
    {
      match: `/projects/${PROD}/advisors/performance`,
      respond: overrides.prodPerformance ?? ok(fixtures.advisorsPerformanceProd),
    },
    { match: `/projects/${STAGING}/advisors/`, respond: ok(fixtures.advisorsStaging) },
  ];
}

describe("fetchSupabaseDashboard", () => {
  it("rates each project by its lifecycle status", async () => {
    const http = mockFetch(routes());
    const dash = await supabaseConnector.fetchDashboard({ apiKey: TOKEN });

    expect(http.unmatched).toEqual([]);
    expect(dash.items).toEqual([
      {
        id: PROD,
        name: "shop-prod",
        provider: "supabase",
        status: "ok",
        detail: "Operational · eu-central-1",
        updatedAt: "2025-11-02T10:00:00.000Z",
      },
      {
        id: STAGING,
        name: "shop-staging",
        provider: "supabase",
        status: "error",
        detail: "Down · us-east-1",
        updatedAt: "2026-01-15T08:30:00.000Z",
      },
    ]);
    expect(dash.healthy).toBe(1);
    expect(dash.total).toBe(2);
  });

  it("lists each service's health, plus edge functions by deploy state", async () => {
    const http = mockFetch(routes());
    const dash = await fetchSupabaseDashboard(TOKEN);

    // `services` is required and must be the full enum, or the call 400s.
    expect(new URL(http.callsTo(`${PROD}/health`)[0].url).searchParams.get("services")).toBe(
      "db,rest,auth,realtime,storage",
    );

    expect(dash.services.map((s) => [s.projectName, s.serviceName, s.status, s.detail])).toEqual([
      ["shop-prod", "Database", "ok", "ACTIVE_HEALTHY"],
      ["shop-prod", "Auth", "ok", "ACTIVE_HEALTHY"],
      ["shop-prod", "PostgREST", "ok", "ACTIVE_HEALTHY"],
      ["shop-prod", "Realtime", "error", "UNHEALTHY"],
      ["shop-prod", "Storage", "warn", "COMING_UP"],
      ["shop-prod", "Edge Functions", "ok", "2 deployed"],
      ["shop-staging", "Database", "error", "UNHEALTHY"],
    ]);
    expect(dash.services[0]).toMatchObject({ id: `${PROD}:db`, healthy: true });
  });

  it("sums request volume by API across projects", async () => {
    mockFetch(routes());
    const dash = await fetchSupabaseDashboard(TOKEN);

    expect(dash.traffic).toEqual([
      { label: "PostgREST", value: 11500, display: "12k" },
      { label: "Auth", value: 320, display: "320" },
      { label: "Storage", value: 80, display: "80" },
      { label: "Realtime", value: 40, display: "40" },
    ]);
    expect(dash.requestVolume).toEqual({
      total: 11940,
      days: 7,
      label: "Across 2 projects · 7 days",
    });
  });

  it("counts advisor findings, errors first, ignoring 'could not check' lints", async () => {
    mockFetch(routes());
    const dash = await fetchSupabaseDashboard(TOKEN);

    // Staging only reported `project_not_active`, which is not a finding.
    expect(dash.advisors).toEqual({
      total: 3,
      errors: 1,
      warnings: 1,
      infos: 1,
      projectCount: 1,
      top: [
        { title: "Function Search Path Mutable", level: "WARN", projectName: "shop-prod" },
        { title: "RLS Disabled in Public", level: "ERROR", projectName: "shop-prod" },
        { title: "Unindexed foreign keys", level: "INFO", projectName: "shop-prod" },
      ],
    });
    expect(dash.advisorIssues.map((i) => [i.level, i.name, i.kind, i.status])).toEqual([
      ["ERROR", "rls_disabled_in_public", "security", "error"],
      ["WARN", "function_search_path_mutable", "security", "warn"],
      ["INFO", "unindexed_foreign_keys", "performance", "idle"],
    ]);
    expect(dash.advisorIssues[0]).toMatchObject({
      id: `${PROD}:rls_disabled_in_public`,
      projectName: "shop-prod",
      detail:
        "Detects cases where row level security (RLS) has not been enabled on tables in schemas exposed to PostgREST",
    });
  });

  it("keeps the other advisor kind when one endpoint fails", async () => {
    mockFetch(routes({ prodSecurity: fail(404, { message: "Not Found" }) }));
    const dash = await fetchSupabaseDashboard(TOKEN);

    expect(dash.advisorIssues.map((i) => i.name)).toEqual(["unindexed_foreign_keys"]);
    expect(dash.advisors.total).toBe(1);
  });

  it("drops a project's service rows, with a warning, when its health check fails", async () => {
    mockFetch(routes({ prodHealth: fail(500, { message: "timeout" }) }));
    const dash = await fetchSupabaseDashboard(TOKEN);

    // Edge functions come from a different endpoint, so their row survives.
    expect(
      dash.services.filter((s) => s.projectName === "shop-prod").map((s) => s.serviceName),
    ).toEqual(["Edge Functions"]);
    expect(warnings()).toEqual([
      `[connector:supabase] service health unavailable {"ref":"${PROD}"}`,
    ]);
  });

  it("says there is no usage data when analytics is rate limited", async () => {
    mockFetch(routes({ prodUsage: fail(429, { message: "Too many requests" }) }));
    const dash = await fetchSupabaseDashboard(TOKEN);

    expect(dash.traffic).toEqual([]);
    expect(dash.requestVolume).toEqual({ total: 0, days: 7, label: "No usage data yet" });
    expect(dash.items).toHaveLength(2);
  });

  it("renders an organization with no projects", async () => {
    mockFetch(routes({ projects: ok([]) }));
    const dash = await fetchSupabaseDashboard(TOKEN);

    expect(dash).toEqual({
      items: [],
      healthy: 0,
      total: 0,
      services: [],
      traffic: [],
      requestVolume: { total: 0, days: 7, label: "No usage data yet" },
      advisors: { total: 0, errors: 0, warnings: 0, infos: 0, projectCount: 0, top: [] },
      advisorIssues: [],
    });
  });

  it("cleans up a pasted token before sending it", async () => {
    const http = mockFetch(routes({ projects: ok([]) }));
    await fetchSupabaseDashboard(`  "Bearer ${TOKEN}"  `);
    expect(http.calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("rejects a project API key without calling Supabase", async () => {
    const http = mockFetch(routes());
    await expect(fetchSupabaseDashboard("eyJhbGciOiJIUzI1NiJ9.e30.x")).rejects.toThrow(
      /looks like a project API key/,
    );
    expect(http.calls).toEqual([]);
  });
});

describe("supabaseConnector.test", () => {
  it("counts the projects it can see", async () => {
    mockFetch(routes());
    expect(await supabaseConnector.test({ apiKey: TOKEN })).toEqual({
      ok: true,
      message: "Connected — 2 project(s)",
    });
  });

  it("explains a token that is not a personal access token", async () => {
    mockFetch(routes({ projects: fail(401, fixtures.invalidJwt) }));
    expect(await supabaseConnector.test({ apiKey: TOKEN })).toEqual({
      ok: false,
      message:
        "Invalid Supabase token. Use a personal access token (sbp_…) from Account → Access Tokens.",
    });
  });

  it("explains a revoked token", async () => {
    mockFetch(routes({ projects: fail(401, fixtures.unauthorized) }));
    const result = await supabaseConnector.test({ apiKey: TOKEN });
    expect(result.message).toBe(
      "Supabase rejected this token. Create a new personal access token and reconnect.",
    );
  });

  it("maps any other failure of the whole dashboard to the Supabase fallback", async () => {
    mockFetch(routes({ projects: fail(500, "upstream connect error") }));
    const error = await fetchSupabaseDashboard(TOKEN).catch((e) => e);
    expect(toUserFacingError(error, "supabase")).toBe(
      "Could not load Supabase data. Try reconnecting the source.",
    );
  });
});
