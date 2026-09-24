import { afterEach, describe, expect, it, vi } from "vitest";
import { byNewest, byOldest, DAY_MS, daysAgo } from "./dates";

afterEach(() => {
  vi.useRealTimers();
});

describe("daysAgo", () => {
  it("counts whole days back from now", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-20T12:00:00.000Z") });
    expect(daysAgo(30).toISOString()).toBe("2026-08-21T12:00:00.000Z");
    expect(daysAgo(0).getTime()).toBe(Date.now());
    expect(Date.now() - daysAgo(1).getTime()).toBe(DAY_MS);
  });
});

describe("byNewest / byOldest", () => {
  const rows = [
    { id: "b", at: "2026-09-19T08:00:00Z" },
    { id: "c", at: "2026-09-20T09:30:00.000+02:00" },
    { id: "a", at: "2026-09-18T23:59:59.999Z" },
  ];

  it("orders mixed timestamp formats both ways", () => {
    expect([...rows].sort(byNewest((r) => r.at)).map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect([...rows].sort(byOldest((r) => r.at)).map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("orders an offset timestamp by the instant it names", () => {
    const sameDay = [
      { id: "late-utc", at: "2026-09-20T08:00:00Z" },
      // 09:00 in +02:00 is 07:00Z, an hour earlier despite the larger clock.
      { id: "early-offset", at: "2026-09-20T09:00:00+02:00" },
    ];
    expect(sameDay.sort(byNewest((r) => r.at)).map((r) => r.id)).toEqual([
      "late-utc",
      "early-offset",
    ]);
  });
});
