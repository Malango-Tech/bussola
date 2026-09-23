import type { RailwayUsageItem } from "../types";
import { railwayGraphql, type AuthMode } from "./client";

/** Railway's estimate of this cycle's resource consumption, per measurement. */

/** `estimatedUsage` requires an explicit measurement list; there is no default. */
const USAGE_MEASUREMENTS = [
  "CPU_USAGE",
  "MEMORY_USAGE_GB",
  "NETWORK_TX_GB",
  "DISK_USAGE_GB",
];

/** Projects sampled at most, to avoid hammering the API on large accounts. */
const MAX_USAGE_PROJECTS = 8;

/** One estimated-usage measurement → its display label and formatted value. */
function usageRow(measurement: string, value: number): { label: string; display: string } {
  const m = measurement.toUpperCase();
  const n = (unit: string) => `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;

  let label: string;
  if (m.includes("CPU")) label = "CPU";
  else if (m.includes("MEMORY")) label = "Memory";
  else if (m.includes("NETWORK_TX") || m.includes("EGRESS")) label = "Egress";
  else if (m.includes("NETWORK_RX")) label = "Ingress";
  else if (m.includes("DISK") || m.includes("VOLUME")) label = "Disk";
  else
    label = measurement
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase());

  let display: string;
  if (m.includes("CPU")) display = n("vCPU·h");
  else if (
    m.includes("MEMORY") ||
    m.includes("DISK") ||
    m.includes("NETWORK") ||
    m.includes("GB")
  )
    display = n("GB");
  else display = value.toFixed(2);

  return { label, display };
}

export async function fetchEstimatedUsage(
  token: string,
  mode: AuthMode,
  projectIds: string[],
): Promise<RailwayUsageItem[]> {
  const aggregates = new Map<string, number>();

  async function pull(projectId?: string) {
    try {
      const data = await railwayGraphql<{
        estimatedUsage: Array<{ measurement: string; estimatedValue: number }>;
      }>(
        token,
        projectId
          ? `query ($projectId: String, $measurements: [MetricMeasurement!]!) {
              estimatedUsage(projectId: $projectId, measurements: $measurements) {
                measurement
                estimatedValue
              }
            }`
          : `query ($measurements: [MetricMeasurement!]!) {
              estimatedUsage(measurements: $measurements) {
                measurement
                estimatedValue
              }
            }`,
        mode,
        projectId
          ? { projectId, measurements: USAGE_MEASUREMENTS }
          : { measurements: USAGE_MEASUREMENTS },
      );
      for (const row of data.estimatedUsage || []) {
        const prev = aggregates.get(row.measurement) || 0;
        aggregates.set(row.measurement, prev + (row.estimatedValue || 0));
      }
    } catch {
      // optional — token/plan may not expose usage
    }
  }

  if (projectIds.length === 0) {
    await pull();
  } else {
    for (const projectId of projectIds.slice(0, MAX_USAGE_PROJECTS)) {
      await pull(projectId);
    }
  }

  const items: RailwayUsageItem[] = [];
  for (const key of USAGE_MEASUREMENTS) {
    const match = [...aggregates.entries()].find(([m]) =>
      m.toUpperCase().includes(key.replace("_USAGE", "").split("_")[0]),
    );
    // Prefer exact-ish matches
    const exact = [...aggregates.entries()].find(
      ([m]) => m.toUpperCase() === key || m.toUpperCase().includes(key),
    );
    const hit = exact || match;
    if (!hit) continue;
    items.push({ measurement: hit[0], value: hit[1], ...usageRow(hit[0], hit[1]) });
  }

  if (items.length === 0) {
    for (const [measurement, value] of aggregates) {
      items.push({ measurement, value, ...usageRow(measurement, value) });
      if (items.length >= 4) break;
    }
  }

  return items.slice(0, 4);
}
