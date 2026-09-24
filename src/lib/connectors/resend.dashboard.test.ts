import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/resend.json";
import {
  fail,
  mockFetch,
  ok,
  setupConnectorTest,
  warnings,
  type MockRoute,
} from "./__fixtures__/mock-fetch";
import { toUserFacingError } from "./errors";
import { fetchResendDashboard, resendConnector } from "./resend";

setupConnectorTest("2026-09-20T12:00:00.000Z");

const credentials = { apiKey: "re_123456789" };

type Overrides = Partial<
  Record<"domains" | "emails" | "broadcasts" | "metrics", MockRoute["respond"]>
>;

function routes(overrides: Overrides = {}): MockRoute[] {
  return [
    {
      match: "api.resend.com/domains",
      respond: overrides.domains ?? ok(fixtures.domains),
    },
    {
      match: "api.resend.com/emails/metrics?",
      respond: overrides.metrics ?? ok(fixtures.metrics),
    },
    {
      match: "api.resend.com/emails?",
      respond: overrides.emails ?? ok(fixtures.emails),
    },
    {
      match: "api.resend.com/broadcasts?",
      respond: overrides.broadcasts ?? ok(fixtures.broadcasts),
    },
  ];
}

describe("fetchResendDashboard", () => {
  it("rates domains by whether they can send", async () => {
    const http = mockFetch(routes());
    const dash = await resendConnector.fetchDashboard(credentials);

    expect(http.unmatched).toEqual([]);
    expect(http.calls[0].headers.authorization).toBe("Bearer re_123456789");
    expect(dash.domains).toEqual([
      {
        id: "d91cd9bd-1176-453e-8fc1-35364d380206",
        name: "mail.acme.dev",
        status: "ok",
        rawStatus: "verified",
        region: "eu-west-1",
        createdAt: "2025-04-26 20:21:26.347412+00",
      },
      {
        id: "ac7a9c2e-0f5d-4b1e-9a8b-1c2d3e4f5a6b",
        name: "news.acme.dev",
        status: "warn",
        rawStatus: "pending",
        region: "us-east-1",
        createdAt: "2026-09-19 08:00:00.000000+00",
      },
      {
        id: "5e4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c",
        name: "old.acme.dev",
        status: "error",
        rawStatus: "partially failed",
        region: "us-east-1",
        createdAt: "2024-01-02 10:00:00.000000+00",
      },
    ]);
    expect(dash.verified).toBe(1);
    expect(dash.total).toBe(3);
  });

  it("reads recent emails and broadcasts", async () => {
    mockFetch(routes());
    const dash = await fetchResendDashboard(credentials);

    expect(dash.emails).toEqual([
      {
        id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
        to: "grace@example.com",
        subject: "Your receipt from Acme",
        status: "opened",
        tone: "ok",
        sentAt: "2026-09-20 10:12:00.123456+00",
      },
      {
        // First recipient only; an empty subject gets a placeholder.
        id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        to: "bounce@example.com",
        subject: "(no subject)",
        status: "bounced",
        tone: "error",
        sentAt: "2026-09-20 09:00:00.000000+00",
      },
      {
        // No event yet: sent, unresolved.
        id: "0f9e8d7c-6b5a-4f3e-9d2c-1b0a9f8e7d6c",
        to: "single@example.com",
        subject: "Welcome aboard",
        status: "sent",
        tone: "idle",
        sentAt: "2026-09-20 08:30:00.000000+00",
      },
    ]);

    // Newest activity first: scheduled, then the draft, then what was sent.
    expect(dash.broadcasts.map((b) => [b.name, b.status, b.tone, b.updatedAt])).toEqual([
      ["Autumn launch", "scheduled", "warn", "2026-09-25 08:00:00.000000+00"],
      ["Untitled", "draft", "idle", "2026-09-10 12:00:00.000000+00"],
      ["September newsletter", "sent", "ok", "2026-09-02 09:00:00.000000+00"],
    ]);
  });

  it("reads two weeks of daily metrics and splits outcomes without double counting", async () => {
    const http = mockFetch(routes());
    const dash = await fetchResendDashboard(credentials);

    const params = new URL(http.callsTo("/emails/metrics")[0].url).searchParams;
    expect(params.get("start_date")).toBe("2026-09-07");
    expect(params.get("end_date")).toBe("2026-09-20");
    expect(params.get("granularity")).toBe("daily");

    const metrics = dash.metrics;
    expect(metrics?.days).toBe(14);
    // The row without a period is dropped; a null rate reads as zero.
    expect(metrics?.points.map((p) => [p.period, p.sent, p.delivered, p.openRate])).toEqual([
      ["2026-09-19", 60, 55, 0.45],
      ["2026-09-20", 40, 37, 0],
    ]);
    expect(metrics?.totals).toEqual({
      sent: 100,
      delivered: 92,
      opened: 55,
      uniqueOpened: 40,
      clicked: 14,
      uniqueClicked: 10,
      failed: 2,
      bounced: 6,
      deliveryRate: 0.92,
      openRate: 0.4348,
      clickRate: 0.1087,
    });
    expect(metrics?.outcomes).toEqual([
      { id: "clicked", name: "Clicked", value: 10 },
      { id: "opened", name: "Opened", value: 30 },
      { id: "delivered", name: "Delivered", value: 52 },
      { id: "failed", name: "Failed", value: 8 },
    ]);
    expect(dash).toMatchObject({
      emailsUnavailable: false,
      broadcastsUnavailable: false,
      metricsUnavailable: false,
    });
  });

  it("degrades section by section for a sending-only key", async () => {
    const restricted = fail(401, fixtures.restrictedKey);
    mockFetch(routes({ emails: restricted, broadcasts: restricted, metrics: restricted }));
    const dash = await fetchResendDashboard(credentials);

    expect(dash.domains).toHaveLength(3);
    expect(dash).toMatchObject({
      emails: [],
      broadcasts: [],
      metrics: null,
      emailsUnavailable: true,
      broadcastsUnavailable: true,
      metricsUnavailable: true,
    });
    expect(warnings().sort()).toEqual([
      '[connector:resend] broadcasts unavailable {"section":"broadcasts"}',
      '[connector:resend] emails unavailable {"section":"emails"}',
      '[connector:resend] metrics unavailable {"section":"metrics"}',
    ]);
  });

  it("renders an account with nothing sent yet", async () => {
    const empty = ok({ object: "list", has_more: false, data: [] });
    mockFetch(
      routes({
        domains: empty,
        emails: empty,
        broadcasts: empty,
        metrics: ok({ totals: {}, data: [] }),
      }),
    );
    const dash = await fetchResendDashboard(credentials);

    expect(dash).toMatchObject({ domains: [], verified: 0, total: 0, emails: [], broadcasts: [] });
    expect(dash.metrics?.totals.sent).toBe(0);
    expect(dash.metrics?.outcomes.every((o) => o.value === 0)).toBe(true);
  });

  it("fails as a whole when domains cannot be read", async () => {
    mockFetch(
      routes({
        domains: fail(429, {
          statusCode: 429,
          message: "Too many requests",
          name: "rate_limit_exceeded",
        }),
      }),
    );
    const error = await fetchResendDashboard(credentials).catch((e) => e);
    expect(toUserFacingError(error, "resend")).toBe(
      "Provider rate limit hit. Try again in a moment.",
    );
  });
});

describe("resendConnector.test", () => {
  it("counts the domains it can see", async () => {
    mockFetch(routes());
    expect(await resendConnector.test(credentials)).toEqual({
      ok: true,
      message: "Connected to Resend (3 domains)",
    });
  });

  it("connects an account without domains", async () => {
    mockFetch(routes({ domains: ok({ object: "list", data: [] }) }));
    expect((await resendConnector.test(credentials)).message).toBe(
      "Connected to Resend — no domains yet",
    );
  });

  it("maps a rejected key", async () => {
    mockFetch(routes({ domains: fail(401, fixtures.restrictedKey) }));
    expect(await resendConnector.test(credentials)).toEqual({
      ok: false,
      message: "Authentication failed. Check the API token and try again.",
    });
  });
});
