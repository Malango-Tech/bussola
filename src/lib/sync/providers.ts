import {
  fetchLemonSqueezyDashboard,
  fetchNetlifyDashboard,
  fetchQontoDashboard,
  fetchRailwayDashboard,
  fetchResendDashboard,
  fetchSentryDashboard,
  fetchStripeDashboard,
  fetchSupabaseDashboard,
  fetchVercelDashboard,
  type ConnectionCredentials,
} from "@/lib/connectors";
import type {
  ProviderSnapshots,
  SnapshotProvider,
} from "@/lib/widgets/snapshots";

/**
 * How to produce a provider's dashboard snapshot. Providers absent from this
 * map have no live connector yet and are never scheduled.
 *
 * Keyed by `SnapshotProvider` and typed per key, so each fetcher is held to the
 * snapshot shape the widgets read for that provider — a connector returning
 * something else fails to compile here, not in a browser.
 */
const FETCHERS: {
  [P in SnapshotProvider]: (
    credentials: ConnectionCredentials,
  ) => Promise<ProviderSnapshots[P]>;
} = {
  railway: (c) => fetchRailwayDashboard(c.apiKey || ""),
  netlify: (c) => fetchNetlifyDashboard(c.apiKey || ""),
  supabase: (c) => fetchSupabaseDashboard(c.apiKey || ""),
  qonto: (c) => fetchQontoDashboard(c),
  stripe: (c) => fetchStripeDashboard(c),
  lemonsqueezy: (c) => fetchLemonSqueezyDashboard(c),
  sentry: (c) => fetchSentryDashboard(c),
  resend: (c) => fetchResendDashboard(c),
  vercel: (c) => fetchVercelDashboard(c),
};

export function isSyncable(provider: string): provider is SnapshotProvider {
  return provider in FETCHERS;
}

export async function fetchDashboardSnapshot<P extends SnapshotProvider>(
  provider: P,
  credentials: ConnectionCredentials,
): Promise<ProviderSnapshots[P]> {
  // Still checked at runtime: the provider comes from a database row, and the
  // type only describes what the caller meant to pass.
  const fetcher:
    | ((credentials: ConnectionCredentials) => Promise<ProviderSnapshots[P]>)
    | undefined = FETCHERS[provider];
  if (!fetcher) {
    throw new Error(`No connector for provider "${provider}"`);
  }
  return fetcher(credentials);
}
