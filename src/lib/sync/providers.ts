import {
  CONNECTORS,
  isSyncableProvider,
  type ConnectionCredentials,
} from "@/lib/connectors";
import type {
  ProviderSnapshots,
  SnapshotProvider,
} from "@/lib/widgets/snapshots";

/**
 * How to produce a provider's dashboard snapshot: the connector registry, seen
 * through the snapshot contract.
 *
 * Assigning the registry to this type is the check. Each connector's
 * `fetchDashboard` must return the snapshot shape the widgets read for its
 * provider, so a connector that drifts from it fails to compile here, not in
 * a browser. Providers with no connector are never scheduled.
 */
type SnapshotFetchers = {
  readonly [P in SnapshotProvider]: {
    fetchDashboard(
      credentials: ConnectionCredentials,
    ): Promise<ProviderSnapshots[P]>;
  };
};

const FETCHERS: SnapshotFetchers = CONNECTORS;

export function isSyncable(provider: string): provider is SnapshotProvider {
  return isSyncableProvider(provider);
}

export async function fetchDashboardSnapshot<P extends SnapshotProvider>(
  provider: P,
  credentials: ConnectionCredentials,
): Promise<ProviderSnapshots[P]> {
  // Still checked at runtime: the provider comes from a database row, and the
  // type only describes what the caller meant to pass.
  if (!isSyncableProvider(provider)) {
    throw new Error(`No connector for provider "${provider}"`);
  }
  const connector: SnapshotFetchers[P] = FETCHERS[provider];
  return connector.fetchDashboard(credentials);
}
