import type { RailwayMetricPoint, RailwayMetricSeries } from "../types";
import { railwayGraphql, type AuthMode } from "./client";

/**
 * Resource metrics for one environment: the latest CPU/memory reading per
 * service for the resources card, and full series for the usage charts.
 */

const METRICS_LOOKBACK_MS = 60 * 60 * 1000;
/** Window and bucket size for the usage charts: a day at 15-minute resolution. */
export const SERIES_HOURS = 24;
const SERIES_SAMPLE_SECONDS = 900;

type MetricsResponse = {
  metrics: Array<{
    measurement: string;
    values?: Array<{ ts?: number | string; value: number | null }>;
  }>;
};

/** Newest finite value of each CPU / memory series, one entry per series. */
function latestSamples(data: MetricsResponse): { cpu: number[]; memory: number[] } {
  const cpu: number[] = [];
  const memory: number[] = [];
  for (const series of data.metrics || []) {
    const values = (series.values || [])
      .map((v) => v.value)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length === 0) continue;
    const latest = values[values.length - 1];
    if (series.measurement === "CPU_USAGE") cpu.push(latest);
    if (series.measurement === "MEMORY_USAGE_GB") memory.push(latest);
  }
  return { cpu, memory };
}

export async function fetchEnvironmentMetrics(
  token: string,
  mode: AuthMode,
  environmentId: string,
): Promise<{ cpu: number[]; memory: number[] }> {
  const startDate = new Date(Date.now() - METRICS_LOOKBACK_MS).toISOString();
  try {
    const data = await railwayGraphql<MetricsResponse>(
      token,
      `query (
        $environmentId: String!
        $startDate: DateTime!
        $measurements: [MetricMeasurement!]!
        $groupBy: [MetricTag!]
      ) {
        metrics(
          environmentId: $environmentId
          startDate: $startDate
          measurements: $measurements
          groupBy: $groupBy
        ) {
          measurement
          values { ts value }
        }
      }`,
      mode,
      {
        environmentId,
        startDate,
        measurements: ["CPU_USAGE", "MEMORY_USAGE_GB"],
        groupBy: ["SERVICE_ID"],
      },
    );
    return latestSamples(data);
  } catch {
    // Fallback without groupBy (environment aggregate).
    try {
      const data = await railwayGraphql<MetricsResponse>(
        token,
        `query (
          $environmentId: String!
          $startDate: DateTime!
          $measurements: [MetricMeasurement!]!
        ) {
          metrics(
            environmentId: $environmentId
            startDate: $startDate
            measurements: $measurements
          ) {
            measurement
            values { value }
          }
        }`,
        mode,
        {
          environmentId,
          startDate,
          measurements: ["CPU_USAGE", "MEMORY_USAGE_GB"],
        },
      );
      return latestSamples(data);
    } catch {
      return { cpu: [], memory: [] };
    }
  }
}

/** Which Railway measurement backs each chart, and how to read its numbers. */
const SERIES_SPECS: Array<{
  key: RailwayMetricSeries["key"];
  measurement: string;
  label: string;
  unit: string;
}> = [
  { key: "cpu", measurement: "CPU_USAGE", label: "CPU", unit: "vCPU" },
  { key: "memory", measurement: "MEMORY_USAGE_GB", label: "Memory", unit: "GB" },
  // TX is what leaves the network — RX would be ingress.
  { key: "egress", measurement: "NETWORK_TX_GB", label: "Egress", unit: "GB" },
  { key: "disk", measurement: "DISK_USAGE_GB", label: "Disk", unit: "GB" },
];

/**
 * Full time series for one environment, for the usage charts.
 *
 * `fetchEnvironmentMetrics` asks the same endpoint but keeps only the latest
 * value per series; these charts need the whole trail, so the sample rate is
 * widened to keep a day inside ~100 points instead of the ~1400 a 60s rate
 * would return.
 */
export async function fetchEnvironmentSeries(
  token: string,
  mode: AuthMode,
  environmentId: string,
): Promise<RailwayMetricSeries[]> {
  const startDate = new Date(Date.now() - SERIES_HOURS * 3_600_000).toISOString();

  const data = await railwayGraphql<{
    metrics: Array<{
      measurement: string;
      values?: Array<{ ts: number | string; value: number | null }>;
    }>;
  }>(
    token,
    `query (
      $environmentId: String!
      $startDate: DateTime!
      $measurements: [MetricMeasurement!]!
      $sampleRateSeconds: Int
    ) {
      metrics(
        environmentId: $environmentId
        startDate: $startDate
        measurements: $measurements
        sampleRateSeconds: $sampleRateSeconds
      ) {
        measurement
        values { ts value }
      }
    }`,
    mode,
    {
      environmentId,
      startDate,
      measurements: SERIES_SPECS.map((s) => s.measurement),
      sampleRateSeconds: SERIES_SAMPLE_SECONDS,
    },
  );

  const byMeasurement = new Map(
    (data.metrics || []).map((series) => [series.measurement, series]),
  );

  const out: RailwayMetricSeries[] = [];
  for (const spec of SERIES_SPECS) {
    const raw = byMeasurement.get(spec.measurement);
    const points: RailwayMetricPoint[] = (raw?.values || [])
      .map((v) => {
        // `ts` comes back as epoch seconds on some series and ISO on others.
        const date =
          typeof v.ts === "number"
            ? new Date(v.ts * 1000)
            : new Date(v.ts);
        return { date, value: v.value };
      })
      .filter(
        (p): p is { date: Date; value: number } =>
          !Number.isNaN(p.date.getTime()) &&
          typeof p.value === "number" &&
          Number.isFinite(p.value),
      )
      .map((p) => ({
        ts: p.date.toISOString(),
        label: p.date.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }),
        value: p.value,
      }));

    if (points.length === 0) continue;

    const values = points.map((p) => p.value);
    out.push({
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      points,
      latest: values[values.length - 1] ?? null,
      peak: Math.max(...values),
      average: values.reduce((sum, v) => sum + v, 0) / values.length,
    });
  }

  return out;
}
