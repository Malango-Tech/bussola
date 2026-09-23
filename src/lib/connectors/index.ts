import { decryptSecret, encryptSecret } from "@/lib/crypto/vault";
import type { TenantRepos } from "@/lib/db/tenant";
import type { Provider } from "@/lib/db/schema";
import { lemonsqueezyConnector } from "./lemonsqueezy";
import { netlifyConnector } from "./netlify";
import { qontoConnector } from "./qonto";
import { railwayConnector } from "./railway";
import { resendConnector } from "./resend";
import { sentryConnector } from "./sentry";
import { stripeConnector } from "./stripe";
import { supabaseConnector } from "./supabase";
import { vercelConnector } from "./vercel";
import type {
  ConnectionCredentials,
  Connector,
  SyncableProvider,
  TestResult,
} from "./types";

/**
 * Every live connector, keyed by the provider it serves.
 *
 * The one list a new connector is added to: the connection test, the sync
 * worker's snapshot fetch and the registry tests all read it. The mapped type
 * pins each entry's `provider` to its key, so a connector registered under the
 * wrong name does not compile.
 */
export const CONNECTORS = {
  railway: railwayConnector,
  netlify: netlifyConnector,
  supabase: supabaseConnector,
  qonto: qontoConnector,
  stripe: stripeConnector,
  lemonsqueezy: lemonsqueezyConnector,
  sentry: sentryConnector,
  resend: resendConnector,
  vercel: vercelConnector,
  // `satisfies` rather than an annotation, so each entry keeps its concrete
  // dashboard type: the sync worker checks those against what widgets read.
} as const satisfies { readonly [P in SyncableProvider]: Connector<unknown, P> };

/** Wave 1: everything that authenticates with a pasted key or token. */
export const LIVE_PROVIDERS: Provider[] = [
  "railway",
  "vercel",
  "netlify",
  "supabase",
  "sentry",
  "stripe",
  "lemonsqueezy",
  "resend",
  "qonto",
] satisfies SyncableProvider[];

/** Wave 2 needs an OAuth app; the rest is planned but unscheduled. */
export const COMING_SOON_PROVIDERS: Provider[] = [
  "github",
  "gitlab",
  "linear",
  "notion",
  "polar",
  "attio",
  "webtraffic",
];

/**
 * Whether a provider has a live connector. An own-property check, so a stored
 * provider string can never resolve to something inherited like `toString`.
 */
export function isSyncableProvider(
  provider: string,
): provider is SyncableProvider {
  return Object.prototype.hasOwnProperty.call(CONNECTORS, provider);
}

export function getConnector(provider: string): Connector | null {
  return isSyncableProvider(provider) ? CONNECTORS[provider] : null;
}

export function parseCredentials(encrypted: string): ConnectionCredentials {
  return JSON.parse(decryptSecret(encrypted)) as ConnectionCredentials;
}

function normalizeCredentials(
  credentials: ConnectionCredentials,
): ConnectionCredentials {
  const trim = (value?: string) => {
    if (value == null) return value;
    const next = value.trim();
    return next.length ? next : undefined;
  };
  return {
    ...credentials,
    apiKey: trim(credentials.apiKey),
    login: trim(credentials.login),
    secretKey: trim(credentials.secretKey),
    accessToken: trim(credentials.accessToken),
    refreshToken: trim(credentials.refreshToken),
    orgSlug: trim(credentials.orgSlug),
  };
}

/**
 * Run the provider's credential check and record the outcome.
 *
 * `repos` is already bound to the caller's organization, so an id belonging to
 * another tenant resolves to nothing rather than being tested or overwritten.
 */
export async function testAndPersist(
  repos: TenantRepos,
  connectionId: string,
): Promise<TestResult> {
  const row = await repos.connections.get(connectionId);
  if (!row) {
    return { ok: false, message: "Connection not found" };
  }

  const connector = getConnector(row.provider);
  if (!connector) {
    return { ok: false, message: "Provider not supported yet" };
  }

  const credentials = parseCredentials(row.credentialsEncrypted);
  const result = await connector.test(credentials);

  await repos.connections.recordTest(connectionId, {
    status: result.ok ? "connected" : "error",
    error: result.ok ? null : result.message,
  });

  return result;
}

export async function upsertConnection(
  repos: TenantRepos,
  input: {
    id?: string;
    provider: Provider;
    label: string;
    credentials: ConnectionCredentials;
  },
): Promise<string | null> {
  const credentialsEncrypted = encryptSecret(
    JSON.stringify(normalizeCredentials(input.credentials)),
  );

  if (input.id) {
    const updated = await repos.connections.update(input.id, {
      label: input.label,
      credentialsEncrypted,
    });
    return updated?.id ?? null;
  }

  const created = await repos.connections.create({
    provider: input.provider,
    label: input.label,
    credentialsEncrypted,
  });
  return created.id;
}

/**
 * Connection rows minus the ciphertext, safe to serialize to the client.
 *
 * Includes the background sync state: whether it is still scheduled, when it
 * last succeeded, and how many attempts have failed in a row. Without that,
 * a connection whose token was revoked looks identical to a healthy one until
 * someone notices the numbers have stopped moving.
 */
export async function listConnections(repos: TenantRepos) {
  const rows = await repos.connections.list();
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    label: row.label,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt,
    lastError: row.lastError,
    syncEnabled: row.syncEnabled,
    lastSyncedAt: row.lastSyncedAt,
    nextSyncAt: row.nextSyncAt,
    consecutiveFailures: row.consecutiveFailures,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export * from "./railway";
export * from "./netlify";
export * from "./supabase";
export * from "./qonto";
export * from "./stripe";
export * from "./lemonsqueezy";
export * from "./sentry";
export * from "./resend";
export * from "./vercel";
export * from "./types";
