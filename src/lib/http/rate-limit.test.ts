import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIMITS,
  callerAddress,
  rateLimit,
  rateLimitHeaders,
  resetRateLimits,
} from "./rate-limit";

afterEach(() => {
  resetRateLimits();
  vi.useRealTimers();
  delete process.env.BUSSOLA_TRUSTED_PROXY_HOPS;
});

const rule = { limit: 3, windowMs: 1000 };

describe("rateLimit", () => {
  it("allows up to the limit and then refuses", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit("a", rule).ok).toBe(true);
    }
    expect(rateLimit("a", rule).ok).toBe(false);
  });

  it("counts down what is left", () => {
    expect(rateLimit("a", rule).remaining).toBe(2);
    expect(rateLimit("a", rule).remaining).toBe(1);
    expect(rateLimit("a", rule).remaining).toBe(0);
  });

  it("keys are independent", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("a", rule);
    expect(rateLimit("a", rule).ok).toBe(false);
    expect(rateLimit("b", rule).ok).toBe(true);
  });

  it("says how long to wait", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("a", rule);
    const denied = rateLimit("a", rule);
    expect(denied.retryAfter).toBeGreaterThan(0);
    expect(denied.retryAfter).toBeLessThanOrEqual(1);
  });

  it("lets the window slide rather than resetting on a fixed boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));

    rateLimit("a", rule);
    rateLimit("a", rule);
    vi.advanceTimersByTime(600);
    rateLimit("a", rule);
    expect(rateLimit("a", rule).ok).toBe(false);

    // The first two age out; the third is still inside the window.
    vi.advanceTimersByTime(500);
    expect(rateLimit("a", rule).ok).toBe(true);
    expect(rateLimit("a", rule).ok).toBe(true);
    expect(rateLimit("a", rule).ok).toBe(false);
  });

  it("recovers fully once the window has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
    for (let i = 0; i < 3; i += 1) rateLimit("a", rule);
    expect(rateLimit("a", rule).ok).toBe(false);

    vi.advanceTimersByTime(1500);
    expect(rateLimit("a", rule).ok).toBe(true);
  });
});

describe("rateLimitHeaders", () => {
  it("omits Retry-After while the caller is inside the limit", () => {
    const headers = rateLimitHeaders(rateLimit("a", rule)) as Record<string, string>;
    expect(headers["RateLimit-Limit"]).toBe("3");
    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("includes Retry-After once refused", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("a", rule);
    const headers = rateLimitHeaders(rateLimit("a", rule)) as Record<string, string>;
    expect(headers["Retry-After"]).toBeDefined();
  });
});

describe("the configured limits", () => {
  it("leaves room for a canvas of widgets polling every 60s", () => {
    // Twelve widgets on a share page, one poll a minute each, is 12/min. The
    // limit has to clear that comfortably or a normal viewer trips it.
    expect(LIMITS.shareData.limit).toBeGreaterThan(60);
  });

  it("meters credential guessing harder than legitimate use", () => {
    expect(LIMITS.mcpAnonymous.limit).toBeLessThan(LIMITS.mcp.limit);
  });
});

describe("under a flood of distinct keys", () => {
  it("evicts the stalest bucket instead of refusing every new caller", () => {
    for (let i = 0; i < 20_000; i += 1) rateLimit(`flood:${i}`, rule);
    // The map is full; a newcomer still gets in.
    expect(rateLimit("flood:newcomer", rule).ok).toBe(true);
  });

  it("keeps namespaces apart, so one flood cannot crowd out another endpoint", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("mcp:agent", rule);
    for (let i = 0; i < 20_000; i += 1) rateLimit(`share-data:${i}`, rule);
    // The MCP caller's window was not evicted by the share-link flood.
    expect(rateLimit("mcp:agent", rule).ok).toBe(false);
  });

  it("keeps a recently active caller's window through a flood", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("share-data:honest", rule);
    for (let i = 0; i < 19_000; i += 1) rateLimit(`share-data:${i}`, rule);
    rateLimit("share-data:honest", rule);
    for (let i = 19_000; i < 21_000; i += 1) rateLimit(`share-data:${i}`, rule);
    expect(rateLimit("share-data:honest", rule).ok).toBe(false);
  });
});

describe("callerAddress", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost/", { headers });

  it("takes the address our proxy appended, not the one the client sent", () => {
    expect(
      callerAddress(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })),
    ).toBe("203.0.113.9");
  });

  it("honours a configured number of trusted proxies", () => {
    process.env.BUSSOLA_TRUSTED_PROXY_HOPS = "2";
    expect(
      callerAddress(
        request({ "x-forwarded-for": "6.6.6.6, 198.51.100.4, 10.0.0.2" }),
      ),
    ).toBe("198.51.100.4");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(callerAddress(request({ "x-real-ip": "192.0.2.1" }))).toBe("192.0.2.1");
    expect(callerAddress(request({}))).toBe("unknown");
  });
});
