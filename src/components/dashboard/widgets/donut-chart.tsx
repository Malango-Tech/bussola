"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/utils";
import { shareSummary } from "./chart-summary";

export type DonutChartItem = {
  id: string;
  name: string;
  value: number;
  display: string;
  sharePct: number;
  highlight?: boolean;
};

type DonutChartProps = {
  items: DonutChartItem[];
  /** What the whole is, e.g. "Account balances" — the start of its accessible name. */
  label?: string;
  className?: string;
};

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** A donut chart with a legend, for showing how a total splits into parts. */
export function DonutChart({ items, label = "Chart", className }: DonutChartProps) {
  const slices = items
    .map((item) => ({ ...item, value: Math.max(item.value, 0) }))
    .filter((item) => item.value > 0);

  if (slices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No positive values to chart.</p>
    );
  }

  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-3",
        className,
      )}
    >
      <div
        className="relative h-full min-h-[120px] w-full"
        role="img"
        aria-label={shareSummary(label, slices)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart accessibilityLayer={false}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={slices.length > 1 ? 2 : 0}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {slices.map((slice, index) => (
                <Cell
                  key={slice.id}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0]?.payload as DonutChartItem | undefined;
                if (!item) return null;
                return (
                  <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
                    <p className="font-medium">{item.name}</p>
                    <p className="tabular-nums text-muted-foreground">
                      {item.display} ·{" "}
                      {item.sharePct.toFixed(item.sharePct % 1 === 0 ? 0 : 1)}%
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex max-h-full min-h-0 flex-col justify-center gap-2 overflow-y-auto overscroll-contain pr-0.5">
        {items.map((item, index) => (
          <li key={item.id} className="flex items-start gap-2 text-xs">
            <span
              className="mt-1 size-2 shrink-0 rounded-full"
              aria-hidden
              style={{
                background:
                  item.value > 0
                    ? CHART_COLORS[index % CHART_COLORS.length]
                    : "var(--muted-foreground)",
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-foreground">
                  {item.name}
                  {item.highlight ? (
                    <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                      Main
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {item.sharePct.toFixed(item.sharePct % 1 === 0 ? 0 : 1)}%
                </span>
              </div>
              <p className="tabular-nums text-muted-foreground">
                {item.display}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
