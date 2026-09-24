// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WidgetRenderer } from "@/components/dashboard/widget-renderer";
import { WidgetFrame } from "@/components/dashboard/widget-frame";
import { WIDGET_REGISTRY, type WidgetType } from "@/lib/widgets/registry";
import {
  isReadThroughType,
  snapshotSourceOf,
  type WirePayload,
} from "@/lib/widgets/snapshots";
import {
  READ_THROUGH_WIDGETS,
  SNAPSHOT_RENDERERS,
  renderSnapshotWidget,
} from "./index";
import { renderWidget, servedDemo, stubLayout } from "./test-harness";

/**
 * Every widget, drawn from the sample data a new account sees.
 *
 * The demo fixtures are shaped like real connector output, so this is the
 * closest a unit test gets to "does each widget still render a real
 * snapshot" — and a widget that falls into its empty state on complete data
 * is almost always reading a field under the wrong name.
 */

const store = vi.hoisted(() => ({
  served: { data: null as Record<string, unknown> | null },
  error: null as string | null,
  loading: false,
}));

vi.mock("@/lib/widgets/widget-data-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/widgets/widget-data-store")>()),
  useWidgetData: () => ({
    data: store.served.data,
    error: store.error,
    loading: store.loading,
  }),
}));

// The real charts, loaded eagerly: `next/dynamic` would render its skeleton
// first, and what is under test is what the chart says once it is there.
vi.mock("@/components/dashboard/widgets/lazy-charts", async () => ({
  LineChart: (await import("@/components/dashboard/widgets/line-chart")).LineChart,
  ColumnChart: (await import("@/components/dashboard/widgets/column-chart")).ColumnChart,
  DonutChart: (await import("@/components/dashboard/widgets/donut-chart")).DonutChart,
  DualLineChart: (await import("@/components/dashboard/widgets/dual-line-chart")).DualLineChart,
}));

beforeAll(stubLayout);

beforeEach(() => {
  store.served.data = null;
  store.error = null;
  store.loading = false;
});

const ALL_TYPES = WIDGET_REGISTRY.map((def) => def.type);

/** Widgets whose picture is a Recharts chart, which must carry a summary. */
const CHARTS = new Set<WidgetType>([
  "railway-cpu",
  "railway-memory",
  "railway-egress",
  "railway-disk",
  "qonto-accounts",
  "qonto-history",
  "resend-delivery",
  "resend-open-rate",
  "resend-click-rate",
  "resend-outcomes",
]);

describe("renderer registry", () => {
  it("has exactly one renderer for every registered widget type", () => {
    const snapshot = Object.keys(SNAPSHOT_RENDERERS);
    const readThrough = Object.keys(READ_THROUGH_WIDGETS);

    expect(snapshot.filter((type) => readThrough.includes(type))).toEqual([]);
    expect([...snapshot, ...readThrough].sort()).toEqual([...ALL_TYPES].sort());
  });

  it("files each snapshot widget under the provider the registry gives it", () => {
    for (const def of WIDGET_REGISTRY) {
      if (isReadThroughType(def.type)) continue;
      const expected = def.provider === "multi" ? "status-board" : def.provider;
      expect(snapshotSourceOf(def.type), def.type).toBe(expected);
    }
  });

  it("says a retired widget type is gone instead of drawing nothing", () => {
    // A row written before a type was removed still names it.
    const retired = "railway-uptime" as unknown as Exclude<WidgetType, "qonto-transactions">;
    render(<>{renderSnapshotWidget(retired, {})}</>);
    expect(
      screen.getByText(/This widget is no longer available/),
    ).toBeInTheDocument();
  });
});

/**
 * Demo payloads known to land a widget in an empty state, and what it says.
 *
 * Each is a fixture bug, not a renderer one, pinned here so it stays visible:
 * once the fixture is fixed this expectation fails and the entry goes.
 */
const KNOWN_EMPTY_ON_DEMO: Partial<Record<WidgetType, string>> = {};

describe("every widget type on its demo payload", () => {
  it.each(ALL_TYPES)("%s renders real content", async (type) => {
    const { container } = await renderWidget(type, servedDemo(type), store.served);

    const knownEmpty = KNOWN_EMPTY_ON_DEMO[type];
    if (knownEmpty) {
      expect(screen.getByText(knownEmpty)).toBeInTheDocument();
      return;
    }

    // Any empty, error or connect state is a WidgetMessage.
    expect(container.querySelector('[data-slot="widget-message"]')).toBeNull();
    expect(container.textContent?.trim().length).toBeGreaterThan(0);

    if (!isReadThroughType(type)) {
      // Sample data is always labelled as such.
      expect(screen.getByText("Demo data")).toBeInTheDocument();
    }
    if (CHARTS.has(type)) {
      const chart = screen.getAllByRole("img").find((node) =>
        /points|%\)/.test(node.getAttribute("aria-label") ?? ""),
      );
      expect(chart, "chart has a data summary").toBeDefined();
    }
  });
});

describe("the frame", () => {
  const railway = (): WirePayload => servedDemo("railway-fleet");

  it("shows a busy skeleton while loading", () => {
    store.loading = true;
    const { container } = render(<WidgetRenderer type="railway-fleet" />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText("Loading widget")).toBeInTheDocument();
  });

  it("passes the server's error through with a way to act on it", () => {
    store.error = "Provider rate limit hit";
    render(<WidgetRenderer type="railway-fleet" />);
    expect(screen.getByText("Provider rate limit hit")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check Connections" })).toBeInTheDocument();
  });

  it("asks for a connection when the source has none", () => {
    store.served.data = { needsConnection: true, provider: "railway", items: [] };
    render(<WidgetRenderer type="railway-fleet" />);
    expect(screen.getByText("Connect Railway to see this widget.")).toBeInTheDocument();
  });

  it("hides a snapshot whose sync was given up on behind a reconnect prompt", () => {
    store.served.data = {
      ...railway(),
      _demo: false,
      _sync: { disabled: true, lastError: "Authentication failed", stale: false },
    };
    render(<WidgetRenderer type="railway-fleet" />);
    expect(screen.getByText("Authentication failed")).toBeInTheDocument();
    expect(screen.queryByText("Healthy services")).toBeNull();
  });

  it("labels stale data and still shows it", () => {
    store.served.data = {
      ...railway(),
      _demo: false,
      _sync: { stale: true, fetchedAt: new Date(Date.now() - 3_600_000).toISOString() },
    };
    render(<WidgetRenderer type="railway-fleet" />);
    expect(screen.getByText(/Last updated about 1 hour ago/)).toBeInTheDocument();
    expect(screen.getByText("Healthy services")).toBeInTheDocument();
  });

  it("applies the widget's own config before drawing", () => {
    store.served.data = railway();
    render(<WidgetRenderer type="railway-services" config={{ scope: "worker" }} />);
    expect(screen.getByText("worker")).toBeInTheDocument();
    expect(screen.queryByText("api")).toBeNull();
  });

  it("names the widget and every icon-only control around it", () => {
    store.served.data = railway();
    render(
      <WidgetFrame
        id="w1"
        type="railway-fleet"
        editMode
        onRemove={() => {}}
        onConfigure={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Fleet Health" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure Fleet Health" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Fleet Health" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Fleet Health in Railway" }),
    ).toBeInTheDocument();
  });

  it("tolerates a snapshot missing the fields a widget reads", () => {
    // A share link or an older snapshot can leave any top-level field out.
    store.served.data = { _demo: false };
    render(<WidgetRenderer type="netlify-forms" />);
    expect(screen.getByText("No Netlify Forms on connected sites.")).toBeInTheDocument();
  });
});
