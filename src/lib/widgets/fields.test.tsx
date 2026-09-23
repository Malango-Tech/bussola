// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  normalizeIds,
  renderWidget,
  servedDemo,
  stubLayout,
} from "@/components/dashboard/widgets/renderers/test-harness";
import { WIDGET_FIELDS, projectPayload } from "./fields";
import { WIDGET_REGISTRY, type WidgetType } from "./registry";
import type { WirePayload } from "./snapshots";

/**
 * WIDGET_FIELDS against what the widgets actually read.
 *
 * The share route trims every snapshot to these fields, so the list is an
 * allowlist with two ways to be wrong. Too short, and a shared widget renders
 * differently from the owner's — caught by rendering each widget from its
 * full payload and from the projection, and requiring identical markup. Too
 * long, and a share link ships data nothing on the page shows — caught by
 * dropping each listed field in turn and requiring the widget to notice.
 */

const store = vi.hoisted(() => ({
  served: { data: null as Record<string, unknown> | null },
}));

vi.mock("@/lib/widgets/widget-data-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/widgets/widget-data-store")>()),
  useWidgetData: () => ({ data: store.served.data, error: null, loading: false }),
}));

// Eager charts: the lazy wrapper's skeleton would hide what each chart reads.
vi.mock("@/components/dashboard/widgets/lazy-charts", async () => ({
  LineChart: (await import("@/components/dashboard/widgets/line-chart")).LineChart,
  ColumnChart: (await import("@/components/dashboard/widgets/column-chart")).ColumnChart,
  DonutChart: (await import("@/components/dashboard/widgets/donut-chart")).DonutChart,
  DualLineChart: (await import("@/components/dashboard/widgets/dual-line-chart")).DualLineChart,
}));

beforeAll(() => {
  stubLayout();
  // Ages ("5m ago") are computed at render; freeze the clock so two renders
  // of the same payload can only differ in what they were given.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date());
});

afterAll(() => {
  vi.useRealTimers();
});

const ALL_TYPES = WIDGET_REGISTRY.map((def) => def.type);

/**
 * Fixture repairs, so each widget is exercised on its populated path.
 *
 * The Netlify demo keys `trackers` by site name where the connector keys them
 * by site id, which leaves the tracker widget empty — and an empty widget
 * reads nothing, so it could not show whether `trackers` belongs on its list.
 */
function populated(type: WidgetType, payload: WirePayload): WirePayload {
  if (type !== "netlify-tracker") return payload;
  const items = payload.items as Array<{ id: string; name: string }>;
  const byName = payload.trackers as Record<string, unknown>;
  return {
    ...payload,
    trackers: Object.fromEntries(items.map((item) => [item.id, byName[item.name]])),
  };
}

async function markup(type: WidgetType, payload: WirePayload): Promise<string> {
  const { container, unmount } = await renderWidget(type, payload, store.served);
  const html = normalizeIds(container.innerHTML);
  unmount();
  return html;
}

describe("WIDGET_FIELDS", () => {
  it.each(ALL_TYPES)("%s renders the same from its share projection", async (type) => {
    const full = populated(type, servedDemo(type));
    const projected = projectPayload([type], full);

    expect(await markup(type, projected)).toBe(await markup(type, full));
  });

  /**
   * Listed fields the demo payload cannot prove are read, because dropping
   * them lands on the same output. Each is read — the reason says where — so
   * each stays on the list; anything new here needs the same justification.
   */
  const UNOBSERVABLE_ON_DEMO: Record<string, string> = {
    "resend-emails:emailsUnavailable": "false in the demo; true swaps the table for a notice",
    "resend-broadcasts:broadcastsUnavailable": "false in the demo; true swaps the table for a notice",
    "resend-delivery:metricsUnavailable": "false in the demo; true swaps the chart for a notice",
    "resend-open-rate:metricsUnavailable": "false in the demo; true swaps the chart for a notice",
    "resend-click-rate:metricsUnavailable": "false in the demo; true swaps the chart for a notice",
    "resend-outcomes:metricsUnavailable": "false in the demo; true swaps the chart for a notice",
    "sentry-issues:truncated": "false in the demo; true adds a + to the count",
    "stripe-revenue:revenue": "supplies the currency, and the demo's (eur) is also the fallback",
    "lemonsqueezy-revenue:revenue": "supplies the currency, and the demo's (usd) is also the fallback",
    "qonto-transactions:nextCursor": "null in the demo; a cursor is what the next page is fetched with",
    "qonto-transactions:hasMore": "false in the demo; true keeps the scroll-for-more footer",
  };

  it.each(ALL_TYPES)("%s reads every field it lists", async (type) => {
    const full = populated(type, servedDemo(type));
    const baseline = await markup(type, projectPayload([type], full));

    for (const field of WIDGET_FIELDS[type]) {
      if (UNOBSERVABLE_ON_DEMO[`${type}:${field}`]) continue;
      const without = projectPayload([type], full);
      delete without[field];
      expect(await markup(type, without), `${type} ignores "${field}"`).not.toBe(
        baseline,
      );
    }
  });

  it("keeps the frame's envelope through a projection", () => {
    const projected = projectPayload(["railway-fleet"], {
      fleet: {},
      items: [],
      _sync: { stale: true },
      _demo: true,
      _v: 2,
      provider: "railway",
      needsConnection: false,
    });
    expect(Object.keys(projected).sort()).toEqual(
      ["_demo", "_sync", "_v", "fleet", "needsConnection", "provider"].sort(),
    );
  });
});
