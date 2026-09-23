// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LineChart } from "./lazy-charts";

/**
 * The lazy chart wrapper: a labelled placeholder first, then the real chart
 * with its data summary once the Recharts chunk has loaded.
 */

beforeAll(async () => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", NoopObserver);
  // Transforming Recharts on first import can take seconds on a busy test
  // run; warm it here so the test times the wrapper, not the transform.
  await import("./line-chart");
});

describe("lazy charts", () => {
  it("shows a busy skeleton, then the chart", async () => {
    const { container } = render(
      <LineChart
        label="Balance"
        points={[
          { label: "1 Sep", value: 100, display: "€100" },
          { label: "2 Sep", value: 150, display: "€150" },
        ]}
      />,
    );

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText("Loading chart")).toBeInTheDocument();

    expect(
      await screen.findByRole("img", {
        name: "Balance: 2 points from 1 Sep to 2 Sep. Latest €150; low €100, high €150.",
      }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading chart")).toBeNull();
  });
});
