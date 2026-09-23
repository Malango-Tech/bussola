import { env } from "@/lib/env";
import type { Provider } from "@/lib/providers";

/** The only snapshot each connection currently produces. */
export const DASHBOARD_KIND = "dashboard";

/**
 * How often the worker refreshes each provider, in seconds.
 *
 * These are decoupled from what a browser polls: widgets read whatever snapshot
 * exists, so a longer interval costs freshness, never latency. Qonto is a bank
 * API with strict limits and its dashboard fans out across several paginated
 * calls, so it is deliberately the slowest.
 */
export const SYNC_INTERVAL_SECONDS: Record<Provider, number> = {
  // Deploy platforms: people watch these while shipping, so keep them brisk.
  //
  // Railway is the exception. Its dashboard fans out to roughly 25 calls — a
  // project query, a deploy list per service, metrics per environment, billing
  // and estimated usage — so a 60s interval put an account with a handful of
  // services near 1,500 requests an hour, past the 1,000/h Hobby ceiling. The
  // 429s that follow fail the whole snapshot, which reads as a broken
  // connection rather than a rate limit.
  railway: 180,
  netlify: 60,
  vercel: 60,
  supabase: 120,
  // Error tracking is worth knowing about quickly.
  sentry: 90,
  // Revenue moves slowly and these are rate-limited more tightly.
  stripe: 180,
  lemonsqueezy: 300,
  resend: 300,
  // Banking API with strict limits, and its dashboard fans out over several
  // paginated calls of its own.
  qonto: 180,
  // Not implemented yet; never scheduled, but the map must stay total.
  github: 300,
  gitlab: 300,
  linear: 300,
  notion: 600,
  polar: 300,
  attio: 300,
  webtraffic: 300,
};

/**
 * Shape version of each provider's stored payload.
 *
 * A snapshot outlives the code that wrote it. When a connector starts
 * returning new sections, every stored payload is suddenly missing them, and
 * widgets reading those keys render "nothing here yet" — which is
 * indistinguishable from an account that genuinely has nothing. Stamping the
 * shape lets a stale snapshot be recognised and refetched on first read
 * instead of being served until the next scheduled tick.
 *
 * Bump a provider's number whenever its dashboard gains or renames a field
 * that a widget reads.
 */
export const PAYLOAD_VERSION: Record<Provider, number> = {
  // 2: adds projects, usage time series and billing.
  railway: 2,
  netlify: 1,
  vercel: 1,
  // 2: adds the advisor issue list, plus per-service health that actually works.
  supabase: 2,
  sentry: 1,
  stripe: 1,
  lemonsqueezy: 1,
  // 2: adds metrics, broadcasts, audience, and per-email/broadcast tone.
  resend: 2,
  qonto: 1,
  github: 1,
  gitlab: 1,
  linear: 1,
  notion: 1,
  polar: 1,
  attio: 1,
  webtraffic: 1,
};

/** Where the shape stamp lives inside a stored payload. */
export const PAYLOAD_VERSION_KEY = "_v";

/** Ceiling for exponential backoff on a failing connection. */
export const MAX_BACKOFF_SECONDS = 60 * 60;

/**
 * After this many consecutive failures the connection stops being synced and
 * the UI asks the owner to reconnect. Without it, a revoked token would be
 * retried against the provider forever.
 */
export const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * How long a claimed connection stays claimed. A worker that dies mid-fetch
 * leaves its claim behind; the lease is what lets the next worker pick it up
 * instead of the row being stuck forever.
 */
export const CLAIM_LEASE_SECONDS = 5 * 60;

/**
 * Connections claimed per tick (`BUSSOLA_SYNC_BATCH`).
 *
 * Functions rather than constants so the value is read when a tick runs, not
 * frozen at whatever the environment was when this module first loaded.
 */
export function batchSize(): number {
  return env().BUSSOLA_SYNC_BATCH;
}

/** How often the scheduler looks for due connections (`BUSSOLA_SYNC_TICK_SECONDS`). */
export function tickIntervalSeconds(): number {
  return env().BUSSOLA_SYNC_TICK_SECONDS;
}

/**
 * Delay before the next run of a connection.
 *
 * On success that is simply the provider's interval. On failure it doubles per
 * consecutive failure so a broken token backs off to hourly instead of
 * hammering the provider — and counting toward the rate limit of every other
 * tenant sharing our egress IP.
 */
export function nextDelaySeconds(
  provider: Provider,
  consecutiveFailures: number,
): number {
  const base = SYNC_INTERVAL_SECONDS[provider] ?? 120;
  if (consecutiveFailures <= 0) return base;
  const backoff = base * 2 ** Math.min(consecutiveFailures, 16);
  return Math.min(backoff, MAX_BACKOFF_SECONDS);
}
