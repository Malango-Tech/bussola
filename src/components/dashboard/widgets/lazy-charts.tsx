"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Recharts-backed charts, loaded on demand.
 *
 * Recharts is the heaviest thing a dashboard can render, and most widgets —
 * stat cards, status lists, tables — never touch it. Importing the charts
 * statically put it in the first chunk of every dashboard and share page all
 * the same; behind `next/dynamic` it arrives only when a chart widget
 * actually has data to draw, and not at all on a board without one.
 *
 * Client-only (`ssr: false`) because there is nothing to prerender: every
 * chart sizes itself from its container with a ResizeObserver, and widget data
 * is fetched in the browser anyway, so the server would only ever render the
 * loading state.
 *
 * Widget renderers import charts from here, never from the chart files
 * directly — that single import site is what keeps Recharts out of the static
 * graph.
 */

function ChartSkeleton() {
  return (
    <div className="flex h-full min-h-16 flex-1 flex-col" aria-busy="true">
      <Skeleton className="min-h-16 w-full flex-1" />
      <span className="sr-only">Loading chart</span>
    </div>
  );
}

const loading = () => <ChartSkeleton />;

export const LineChart = dynamic(
  () => import("./line-chart").then((m) => m.LineChart),
  { ssr: false, loading },
);

export const ColumnChart = dynamic(
  () => import("./column-chart").then((m) => m.ColumnChart),
  { ssr: false, loading },
);

export const DonutChart = dynamic(
  () => import("./donut-chart").then((m) => m.DonutChart),
  { ssr: false, loading },
);

export const DualLineChart = dynamic(
  () => import("./dual-line-chart").then((m) => m.DualLineChart),
  { ssr: false, loading },
);
