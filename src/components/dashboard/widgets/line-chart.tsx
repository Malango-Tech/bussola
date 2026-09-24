"use client";

import {
  Area,
  AreaChart as RechartsAreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { seriesSummary } from "./chart-summary";

export type LineChartPoint = {
  label: string;
  value: number;
  display: string;
};

type LineChartProps = {
  points: LineChartPoint[];
  /** What the series measures, e.g. "CPU" — the start of its accessible name. */
  label?: string;
  className?: string;
};

/** A single-series area/line chart for a value over time. */
export function LineChart({ points, label = "Chart", className }: LineChartProps) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough history to chart yet.
      </p>
    );
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.08, Math.abs(max) * 0.02, 1);
  const domainMin = min - pad;
  const domainMax = max + pad;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div
        className="min-h-0 flex-1"
        role="img"
        aria-label={seriesSummary(label, points)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <RechartsAreaChart
            data={points}
            // The wrapper is the accessible element; Recharts' own layer would
            // add an unnamed, focusable "application" inside an image.
            accessibilityLayer={false}
            margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="lineChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--chart-1)"
                  stopOpacity={0.35}
                />
                <stop
                  offset="100%"
                  stopColor="var(--chart-1)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              interval="preserveStartEnd"
              minTickGap={28}
              dy={4}
            />
            <YAxis hide domain={[domainMin, domainMax]} />
            <Tooltip
              cursor={{
                stroke: "var(--border)",
                strokeDasharray: "3 3",
              }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0]?.payload as LineChartPoint | undefined;
                if (!item) return null;
                return (
                  <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
                    <p className="text-muted-foreground">{item.label}</p>
                    <p className="font-medium tabular-nums">{item.display}</p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#lineChartFill)"
              isAnimationActive={false}
              activeDot={{
                r: 3.5,
                strokeWidth: 0,
                fill: "var(--chart-1)",
              }}
            />
          </RechartsAreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
