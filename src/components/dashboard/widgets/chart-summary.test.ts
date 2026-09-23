import { describe, expect, it } from "vitest";
import {
  dualSeriesSummary,
  seriesSummary,
  shareSummary,
  statusStripSummary,
} from "./chart-summary";

describe("chart summaries", () => {
  it("gives a series its span, latest value and range", () => {
    expect(
      seriesSummary("CPU", [
        { label: "09:00", value: 0.3, display: "0.300 vCPU" },
        { label: "09:15", value: 0.7, display: "0.700 vCPU" },
        { label: "09:30", value: 0.5, display: "0.500 vCPU" },
      ]),
    ).toBe(
      "CPU: 3 points from 09:00 to 09:30. Latest 0.500 vCPU; low 0.300 vCPU, high 0.700 vCPU.",
    );
    expect(seriesSummary("CPU", [])).toBe("CPU: no data");
  });

  it("lists each share with its percentage", () => {
    expect(
      shareSummary("Balance by account", [
        { name: "Main", display: "€18,420", sharePct: 78 },
        { name: "Tax", display: "€5,210", sharePct: 21.6 },
      ]),
    ).toBe("Balance by account: Main €18,420 (78%), Tax €5,210 (21.6%).");
  });

  it("states both series of a dual chart at the latest point", () => {
    expect(
      dualSeriesSummary("Emails", "Deliverability", [
        { label: "1 Sep", countDisplay: "9 sent", rateDisplay: "100% delivered" },
        { label: "2 Sep", countDisplay: "4 sent", rateDisplay: "75% delivered" },
      ]),
    ).toBe(
      "Emails and Deliverability: 2 points from 1 Sep to 2 Sep. Latest 2 Sep: 4 sent, 75% delivered.",
    );
  });

  it("counts a status strip by state, in words rather than colors", () => {
    expect(
      statusStripSummary("Deploy history", [
        { status: "ok" },
        { status: "warn" },
        { status: "ok" },
        { status: "error" },
      ]),
    ).toBe("Deploy history: 4 entries, 2 ok, 1 warning, 1 failed. Most recent failed.");
    expect(statusStripSummary("Deploy history", [])).toBe("Deploy history: no history");
  });
});
