"use client";

import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { dualSeriesSummary } from "./chart-summary";

export type DualLinePoint = {
  label: string;
  /** Left axis — a count, scaled to the data. */
  count: number;
  /** Right axis — a percentage, always drawn against a fixed 0–100. */
  rate: number;
  countDisplay: string;
  rateDisplay: string;
};

type DualLineChartProps = {
  points: DualLinePoint[];
  countLabel: string;
  rateLabel: string;
  className?: string;
};

/**
 * A count and a percentage sharing an x-axis on two independent scales.
 *
 * Volume and rate answer different halves of the same question — "did we send
 * more?" and "did more of it land?" — and putting them on one axis would flatten
 * whichever is smaller, so the rate keeps a fixed 0–100 axis of its own.
 */
export function DualLineChart({
  points,
  countLabel,
  rateLabel,
  className,
}: DualLineChartProps) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough history to chart yet.
      </p>
    );
  }

  const maxCount = Math.max(...points.map((point) => point.count), 1);

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            aria-hidden
            style={{ background: "var(--chart-1)" }}
          />
          {countLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            aria-hidden
            style={{ background: "var(--chart-4)" }}
          />
          {rateLabel}
        </span>
      </div>
      <div
        className="min-h-0 flex-1"
        role="img"
        aria-label={dualSeriesSummary(countLabel, rateLabel, points)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={points}
            accessibilityLayer={false}
            margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="dualLineFill" x1="0" y1="0" x2="0" y2="1">
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
            <YAxis yAxisId="count" hide domain={[0, maxCount * 1.15]} />
            <YAxis yAxisId="rate" hide domain={[0, 100]} />
            <Tooltip
              cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0]?.payload as DualLinePoint | undefined;
                if (!item) return null;
                return (
                  <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
                    <p className="text-muted-foreground">{item.label}</p>
                    <p className="font-medium tabular-nums">
                      {item.countDisplay}
                    </p>
                    <p className="tabular-nums text-muted-foreground">
                      {item.rateDisplay}
                    </p>
                  </div>
                );
              }}
            />
            <Area
              yAxisId="count"
              type="monotone"
              dataKey="count"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#dualLineFill)"
              isAnimationActive={false}
              activeDot={{ r: 3.5, strokeWidth: 0, fill: "var(--chart-1)" }}
            />
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="rate"
              stroke="var(--chart-4)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 3.5, strokeWidth: 0, fill: "var(--chart-4)" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
