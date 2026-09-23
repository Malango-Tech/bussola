/**
 * What a chart says, as a sentence.
 *
 * A chart's numbers otherwise live only in its shape and in a hover tooltip,
 * neither of which reaches a screen reader or a keyboard. Each chart wrapper
 * is exposed as one `role="img"` whose name is built here, from the same
 * points it draws — so the summary cannot disagree with the picture, and it
 * carries the figures someone would hover for: where the series ends up and
 * how far it ranges.
 */

type SeriesPoint = { label: string; value: number; display: string };

function span(points: Array<{ label: string }>): string {
  const first = points[0]?.label;
  const last = points[points.length - 1]?.label;
  if (!first || !last) return `${points.length} points`;
  return first === last
    ? `${points.length} points at ${first}`
    : `${points.length} points from ${first} to ${last}`;
}

function extremes<T extends { value: number }>(points: T[]): { low: T; high: T } {
  let low = points[0];
  let high = points[0];
  for (const point of points) {
    if (point.value < low.value) low = point;
    if (point.value > high.value) high = point;
  }
  return { low, high };
}

/** "CPU: 96 points from 09:00 to 08:45. Latest 0.31 vCPU; low 0.30, high 0.68." */
export function seriesSummary(label: string, points: SeriesPoint[]): string {
  if (points.length === 0) return `${label}: no data`;
  const latest = points[points.length - 1];
  const { low, high } = extremes(points);
  return `${label}: ${span(points)}. Latest ${latest.display}; low ${low.display}, high ${high.display}.`;
}

/** "Email outcomes: Clicked 9 emails (7%), Opened 52 emails (41%)." */
export function shareSummary(
  label: string,
  items: Array<{ name: string; display: string; sharePct: number }>,
): string {
  if (items.length === 0) return `${label}: no data`;
  const parts = items.map(
    (item) =>
      `${item.name} ${item.display} (${item.sharePct.toFixed(item.sharePct % 1 === 0 ? 0 : 1)}%)`,
  );
  return `${label}: ${parts.join(", ")}.`;
}

/** Two series on one axis: the count and the rate, each with its latest value. */
export function dualSeriesSummary(
  countLabel: string,
  rateLabel: string,
  points: Array<{ label: string; countDisplay: string; rateDisplay: string }>,
): string {
  if (points.length === 0) return `${countLabel} and ${rateLabel}: no data`;
  const latest = points[points.length - 1];
  return `${countLabel} and ${rateLabel}: ${span(points)}. Latest ${latest.label}: ${latest.countDisplay}, ${latest.rateDisplay}.`;
}

/**
 * A strip of status blocks, counted by state:
 * "Deploy history: 12 entries, 11 ok, 1 warning. Most recent ok."
 */
export function statusStripSummary(
  label: string,
  blocks: Array<{ status?: string }>,
): string {
  if (blocks.length === 0) return `${label}: no history`;
  const words: Record<string, string> = {
    ok: "ok",
    warn: "warning",
    error: "failed",
    idle: "idle",
  };
  const counts = new Map<string, number>();
  for (const block of blocks) {
    const word = words[block.status ?? ""] ?? "unknown";
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const parts = [...counts].map(([word, count]) => `${count} ${word}`);
  return `${label}: ${blocks.length} entries, ${parts.join(", ")}. Most recent ${words[blocks[blocks.length - 1]?.status ?? ""] ?? "unknown"}.`;
}
