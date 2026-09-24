import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/**
 * The headers every response carries. Checked here rather than trusted to a
 * config file nobody re-reads: dropping one silently re-opens clickjacking or
 * token leakage through the Referer header.
 */
describe("security headers", () => {
  it("applies a hardened header set to every path", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*");
    expect(all).toBeDefined();

    const headers = Object.fromEntries(
      all!.headers.map((header) => [header.key, header.value]),
    );
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    // Share tokens live in the URL path.
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d+/);

    const csp = headers["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
