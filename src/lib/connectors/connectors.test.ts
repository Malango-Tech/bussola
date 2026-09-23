import { describe, expect, it } from "vitest";
import { orderStatus } from "./lemonsqueezy";
import { levelStatus, projectStatus } from "./sentry";
import {
  broadcastStatusTone,
  domainStatus,
  domainStatusLabel,
  emailStatusTone,
  outcomeSlices,
} from "./resend";
import type { ResendMetricTotals } from "./types";
import { deployStateLabel, deployStatus } from "./vercel";
import {
  COMING_SOON_PROVIDERS,
  CONNECTORS,
  LIVE_PROVIDERS,
  getConnector,
  isSyncableProvider,
} from "./index";

describe("Lemon Squeezy order status", () => {
  it("maps the paid states", () => {
    expect(orderStatus("paid")).toBe("succeeded");
    expect(orderStatus("pending")).toBe("pending");
  });

  it("treats both refund shapes as refunded", () => {
    expect(orderStatus("refunded")).toBe("refunded");
    expect(orderStatus("partial_refund")).toBe("refunded");
  });

  it("does not assume success for an unknown state", () => {
    expect(orderStatus("mystery")).toBe("failed");
    expect(orderStatus(undefined)).toBe("failed");
  });
});

describe("Sentry mapping", () => {
  it("treats fatal and error alike", () => {
    expect(levelStatus("fatal")).toBe("error");
    expect(levelStatus("error")).toBe("error");
    expect(levelStatus("warning")).toBe("warn");
    expect(levelStatus("info")).toBe("ok");
    expect(levelStatus(undefined)).toBe("idle");
  });

  it("marks a project that has never reported as idle, not healthy", () => {
    expect(projectStatus({ status: "active", firstEvent: null })).toBe("idle");
    expect(projectStatus({ status: "active", firstEvent: "2026-01-01" })).toBe(
      "ok",
    );
  });

  it("flags a project that is not active", () => {
    expect(projectStatus({ status: "pending_deletion" })).toBe("warn");
  });
});

describe("Resend domain status", () => {
  it("only counts a verified domain as healthy", () => {
    expect(domainStatus("verified")).toBe("ok");
    expect(domainStatus("pending")).toBe("warn");
    expect(domainStatus("failed")).toBe("error");
    expect(domainStatus("not_started")).toBe("error");
  });

  it("renders raw statuses readably", () => {
    expect(domainStatusLabel("temporary_failure")).toBe("temporary failure");
    expect(domainStatusLabel(undefined)).toBe("Unknown");
  });
});

describe("Resend email status tone", () => {
  it("treats engagement as a good outcome, not just delivery", () => {
    expect(emailStatusTone("delivered")).toBe("ok");
    expect(emailStatusTone("opened")).toBe("ok");
    expect(emailStatusTone("clicked")).toBe("ok");
  });

  it("separates a hard failure from a soft one", () => {
    expect(emailStatusTone("bounced")).toBe("error");
    expect(emailStatusTone("failed")).toBe("error");
    expect(emailStatusTone("delivery_delayed")).toBe("warn");
    expect(emailStatusTone("complained")).toBe("warn");
  });

  it("leaves an unresolved send neutral", () => {
    expect(emailStatusTone("queued")).toBe("idle");
    expect(emailStatusTone("scheduled")).toBe("idle");
    expect(emailStatusTone(undefined)).toBe("idle");
  });
});

describe("Resend broadcast status tone", () => {
  it("maps the lifecycle", () => {
    expect(broadcastStatusTone("sent")).toBe("ok");
    expect(broadcastStatusTone("scheduled")).toBe("warn");
    expect(broadcastStatusTone("queued")).toBe("warn");
    expect(broadcastStatusTone("canceled")).toBe("error");
    expect(broadcastStatusTone("draft")).toBe("idle");
  });
});

describe("Resend outcome slices", () => {
  const totals = (over: Partial<ResendMetricTotals>): ResendMetricTotals => ({
    sent: 0,
    delivered: 0,
    opened: 0,
    uniqueOpened: 0,
    clicked: 0,
    uniqueClicked: 0,
    failed: 0,
    bounced: 0,
    deliveryRate: 0,
    openRate: 0,
    clickRate: 0,
    ...over,
  });

  const bySlice = (input: ResendMetricTotals) =>
    Object.fromEntries(
      outcomeSlices(input).map((slice) => [slice.id, slice.value]),
    );

  it("counts each email once, at the furthest step it reached", () => {
    // 100 delivered, 40 of them opened, 10 of those also clicked.
    const result = bySlice(
      totals({
        sent: 100,
        delivered: 100,
        uniqueOpened: 40,
        uniqueClicked: 10,
      }),
    );
    expect(result).toEqual({
      clicked: 10,
      opened: 30,
      delivered: 60,
      failed: 0,
    });
  });

  it("sums back to what was sent", () => {
    const input = totals({
      sent: 100,
      delivered: 92,
      uniqueOpened: 40,
      uniqueClicked: 10,
      bounced: 6,
      failed: 2,
    });
    const sum = outcomeSlices(input).reduce((acc, s) => acc + s.value, 0);
    expect(sum).toBe(input.sent);
  });

  it("ignores repeat opens, which would otherwise overcount", () => {
    // 30 opens spread across 19 recipients — the slice follows the unique count.
    const result = bySlice(
      totals({ sent: 27, delivered: 27, opened: 30, uniqueOpened: 19 }),
    );
    expect(result.opened).toBe(19);
    expect(result.delivered).toBe(8);
  });

  it("never produces a negative slice when counts disagree", () => {
    // Opens can be attributed to a delivery from before the window.
    const result = bySlice(
      totals({ sent: 5, delivered: 5, uniqueOpened: 9, uniqueClicked: 7 }),
    );
    expect(result.opened).toBe(2);
    expect(result.delivered).toBe(0);
  });
});

describe("Vercel deploy status", () => {
  it("maps ready states", () => {
    expect(deployStatus("READY")).toBe("ok");
    expect(deployStatus("ERROR")).toBe("error");
    expect(deployStatus("BUILDING")).toBe("warn");
    expect(deployStatus("QUEUED")).toBe("warn");
    expect(deployStatus("CANCELED")).toBe("idle");
    expect(deployStatus(undefined)).toBe("idle");
  });

  it("labels states in sentence case", () => {
    expect(deployStateLabel("READY")).toBe("Ready");
    expect(deployStateLabel("BUILDING")).toBe("Building");
    expect(deployStateLabel(undefined)).toBe("Unknown");
  });
});

describe("connector registry", () => {
  it("has a working connector for every live provider", () => {
    for (const provider of LIVE_PROVIDERS) {
      expect(getConnector(provider), provider).not.toBeNull();
    }
  });

  it("covers all nine live providers, and nothing else", () => {
    // Spelled out on purpose: dropping a provider from either list by
    // accident should fail here rather than silently stop its syncs.
    const expected = [
      "railway",
      "vercel",
      "netlify",
      "supabase",
      "sentry",
      "stripe",
      "lemonsqueezy",
      "resend",
      "qonto",
    ];
    expect([...LIVE_PROVIDERS].sort()).toEqual([...expected].sort());
    expect(Object.keys(CONNECTORS).sort()).toEqual([...expected].sort());
  });

  it("registers each connector under the provider it serves", () => {
    for (const [key, connector] of Object.entries(CONNECTORS)) {
      expect(connector.provider, key).toBe(key);
      expect(typeof connector.test, key).toBe("function");
      expect(typeof connector.fetchDashboard, key).toBe("function");
      expect(getConnector(key), key).toBe(connector);
    }
  });

  it("only treats registered providers as syncable", () => {
    expect(isSyncableProvider("railway")).toBe(true);
    expect(isSyncableProvider("github")).toBe(false);
    // A provider string straight from the database must not reach the
    // prototype chain.
    expect(isSyncableProvider("toString")).toBe(false);
    expect(getConnector("constructor")).toBeNull();
  });

  it("does not offer a connector for a coming-soon provider", () => {
    for (const provider of COMING_SOON_PROVIDERS) {
      expect(getConnector(provider), provider).toBeNull();
    }
  });

  it("never lists a provider as both live and coming soon", () => {
    const overlap = LIVE_PROVIDERS.filter((p) =>
      COMING_SOON_PROVIDERS.includes(p),
    );
    expect(overlap).toEqual([]);
  });
});
