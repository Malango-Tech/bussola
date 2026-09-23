import { cn } from "@/lib/utils";

export type BarChartRow = {
  label: string;
  value: number;
  display: string;
  tone?: "in" | "out" | "neutral";
};

type BarChartProps = {
  rows: BarChartRow[];
  className?: string;
};

function barTone(tone: BarChartRow["tone"]): string {
  switch (tone) {
    case "in":
      return "bg-success";
    case "out":
      return "bg-foreground/70";
    case "neutral":
    case undefined:
      return "bg-primary";
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }
}

/** Horizontal bars comparing a handful of labeled values. */
export function BarChart({ rows, className }: BarChartProps) {
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <div
      className={cn("flex h-full flex-col justify-center gap-4", className)}
    >
      {rows.map((row, index) => {
        const width = `${Math.max((Math.abs(row.value) / max) * 100, 4)}%`;
        return (
          <div key={`${row.label}-${index}`} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium tabular-nums text-foreground">
                {row.display}
              </span>
            </div>
            {/* The label and figure above already say it; the bar only draws it. */}
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                  barTone(row.tone),
                )}
                style={{ width }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
