"use client";

import {
  Bar,
  BarChart as RechartsBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { seriesSummary } from "./chart-summary";

export type ColumnChartPoint = {
  label: string;
  value: number;
  display: string;
  /** Supporting line in the tooltip, e.g. "7 of 12 delivered". */
  hint?: string;
};

type ColumnChartProps = {
  points: ColumnChartPoint[];
  /** Headline number shown above the columns — the period total, not a sum of bars. */
  headline?: { label: string; value: string };
  /** Fixed upper bound, so rate charts stay comparable day to day. */
  domainMax?: number;
  /** What the columns measure, e.g. "Open rate" — the start of its accessible name. */
  label?: string;
  className?: string;
};

/**
 * Vertical columns over time, with the period figure as a headline.
 *
 * Rates are the case this exists for: a daily open rate means little as a bare
 * average, and the horizontal `BarChart` is built for a handful of named
 * categories rather than a two-week trail.
 */
export function ColumnChart({
  points,
  headline,
  domainMax,
  label = "Chart",
  className,
}: ColumnChartProps) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nothing to chart yet.</p>
    );
  }

  const max = domainMax ?? Math.max(...points.map((point) => point.value), 1);

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      {headline ? (
        <div>
          <p className="text-sm text-muted-foreground">{headline.label}</p>
          <p className="mt-0.5 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
            {headline.value}
          </p>
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1"
        role="img"
        aria-label={seriesSummary(label, points)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <RechartsBarChart
            data={points}
            accessibilityLayer={false}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          >
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              interval="preserveStartEnd"
              minTickGap={24}
              dy={4}
            />
            <YAxis hide domain={[0, max]} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0]?.payload as
                  | ColumnChartPoint
                  | undefined;
                if (!item) return null;
                return (
                  <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
                    <p className="text-muted-foreground">{item.label}</p>
                    <p className="font-medium tabular-nums">{item.display}</p>
                    {item.hint ? (
                      <p className="text-muted-foreground">{item.hint}</p>
                    ) : null}
                  </div>
                );
              }}
            />
            <Bar
              dataKey="value"
              fill="var(--chart-1)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
