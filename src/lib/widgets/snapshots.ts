import type {
  LemonSqueezyDashboard,
  NetlifyDashboard,
  QontoDashboard,
  RailwayDashboard,
  ResendDashboard,
  SentryDashboard,
  StatusItem,
  StripeDashboard,
  SupabaseDashboard,
  VercelDashboard,
} from "@/lib/connectors/types";
import type { Provider } from "@/lib/providers";
import type { WidgetType } from "./registry";

/**
 * The contract between the sync worker and the widgets that read its output.
 *
 * A snapshot is written in one process (the worker, from a connector's return
 * value), stored as JSON, and read in another (a browser, through
 * `/api/widgets/data` or a share link). Nothing on that path checks the shape,
 * so it is pinned here instead: `fetchDashboardSnapshot` is typed to return
 * exactly `ProviderSnapshots[P]`, and every widget renderer is typed to read
 * `ServedSnapshot<P>` — the same shape, as it arrives. A connector that renames
 * a field then fails to compile at the renderer that reads it, rather than
 * shipping a widget that quietly says "no data".
 */

/* ───────────────────────────── per provider ───────────────────────────── */

/*
 * One alias per provider, not new types: the connector's own dashboard type is
 * already the truth, and a parallel definition here would be one more thing to
 * keep in step. The aliases exist so widget code can name what it reads
 * without reaching into the connector layer's vocabulary.
 */
export type RailwaySnapshot = RailwayDashboard;
export type NetlifySnapshot = NetlifyDashboard;
export type SupabaseSnapshot = SupabaseDashboard;
export type QontoSnapshot = QontoDashboard;
export type StripeSnapshot = StripeDashboard;
export type LemonSqueezySnapshot = LemonSqueezyDashboard;
export type SentrySnapshot = SentryDashboard;
export type ResendSnapshot = ResendDashboard;
export type VercelSnapshot = VercelDashboard;

/** What the sync worker stores for each provider it can fetch. */
export type ProviderSnapshots = {
  railway: RailwaySnapshot;
  netlify: NetlifySnapshot;
  supabase: SupabaseSnapshot;
  qonto: QontoSnapshot;
  stripe: StripeSnapshot;
  lemonsqueezy: LemonSqueezySnapshot;
  sentry: SentrySnapshot;
  resend: ResendSnapshot;
  vercel: VercelSnapshot;
};

/** Providers with a connector that produces a snapshot. */
export type SnapshotProvider = keyof ProviderSnapshots;

/*
 * Every snapshot provider must be a real provider. Written as a type that only
 * resolves to `true` when the condition holds, so adding a key above that the
 * provider list does not know fails here rather than somewhere downstream.
 */
const _snapshotProvidersAreProviders: SnapshotProvider extends Provider
  ? true
  : never = true;
void _snapshotProvidersAreProviders;

export const SNAPSHOT_PROVIDERS = [
  "railway",
  "netlify",
  "supabase",
  "qonto",
  "stripe",
  "lemonsqueezy",
  "sentry",
  "resend",
  "vercel",
] as const satisfies readonly SnapshotProvider[];

/*
 * And the list above must name every one of them: an entry missing from it
 * leaves this `Exclude` non-empty, which is not assignable to `never`.
 */
const _snapshotProvidersListed: [
  Exclude<SnapshotProvider, (typeof SNAPSHOT_PROVIDERS)[number]>,
] extends [never]
  ? true
  : never = true;
void _snapshotProvidersListed;

export function isSnapshotProvider(value: string): value is SnapshotProvider {
  return (SNAPSHOT_PROVIDERS as readonly string[]).includes(value);
}

/* ───────────────────────────── cross-source ───────────────────────────── */

/**
 * A row on the cross-source status board.
 *
 * Assembled at read time from every connection's `items`, so it is a status
 * item plus where it came from. The underscore fields are added by the server
 * and read by the client-side connection filter, never displayed.
 */
export type StatusBoardItem = StatusItem & {
  _source?: string;
  _connectionId?: string;
};

export type StatusBoardSnapshot = {
  items: StatusBoardItem[];
  /** The board is configured to read no connections at all. */
  noSourcesSelected?: boolean;
};

/** Everything a snapshot widget can be fed from: one provider, or all of them. */
export type SourceSnapshots = ProviderSnapshots & {
  "status-board": StatusBoardSnapshot;
};

export type SnapshotSource = keyof SourceSnapshots;

/* ─────────────────────────────── envelope ─────────────────────────────── */

/**
 * The sync state the server attaches when it serves a stored snapshot.
 *
 * `disabled` means the worker gave up on the connection, which the frame must
 * show instead of the (possibly long-dead) numbers underneath it.
 */
export type SyncMeta = {
  fetchedAt?: string | null;
  stale?: boolean;
  disabled?: boolean;
  lastError?: string | null;
  connectionId?: string;
  connectionLabel?: string | null;
};

/**
 * Metadata around a payload, as opposed to provider data inside it.
 *
 * Underscore keys are the server's (`_sync`, `_demo`) or the worker's (`_v`);
 * the share route passes them through untrimmed for that reason. The other two
 * belong to the "not connected" answer, which carries no provider data at all.
 */
export type SnapshotEnvelope = {
  /** Shape version the worker stamped (`PAYLOAD_VERSION`). */
  _v?: number;
  _sync?: SyncMeta;
  /** Sample data standing in for an unconnected source. */
  _demo?: boolean;
  needsConnection?: boolean;
  provider?: string;
};

/**
 * A snapshot as a widget receives it.
 *
 * `Partial` is not caution for its own sake — each of these really happens:
 * a share link trims the payload to the fields its widgets read
 * (`projectPayload`), a snapshot written before a field existed is served
 * until its re-sync lands, and a "not connected" answer has none of it. So a
 * renderer must treat every top-level field as possibly absent, and the type
 * says so. Below the top level, values are whole DTOs: nothing trims inside
 * them except widget config, which only ever shortens arrays.
 */
export type ServedSnapshot<S extends SnapshotSource> = Partial<
  SourceSnapshots[S]
> &
  SnapshotEnvelope;

/** A payload as it comes off the wire, before anything has vouched for it. */
export type WirePayload = Record<string, unknown>;

/* ─────────────────────────── widget ↔ source ──────────────────────────── */

/**
 * Widget types served live from the provider rather than from a snapshot.
 *
 * Cursor pagination cannot be snapshotted usefully, so these fetch their own
 * data and never see a `ServedSnapshot`.
 */
export const READ_THROUGH_TYPES = ["qonto-transactions"] as const satisfies readonly WidgetType[];

export type ReadThroughWidgetType = (typeof READ_THROUGH_TYPES)[number];
export type SnapshotWidgetType = Exclude<WidgetType, ReadThroughWidgetType>;

export function isReadThroughType(
  type: WidgetType,
): type is ReadThroughWidgetType {
  return (READ_THROUGH_TYPES as readonly string[]).includes(type);
}

/**
 * Which snapshot a widget type reads, worked out from its name.
 *
 * Widget types are `<provider>-<what>` by convention; this makes the
 * convention load-bearing, so a renderer for `railway-cpu` is typed against
 * `RailwaySnapshot` without anyone having to say so twice.
 */
export type SourceOf<T extends SnapshotWidgetType> = T extends "status-board"
  ? "status-board"
  : T extends `${infer P}-${string}`
    ? P extends SnapshotProvider
      ? P
      : never
    : never;

/*
 * A widget type whose prefix is not a snapshot provider would resolve to
 * `never` and get a renderer that can be handed nothing. Fail here instead.
 */
type UnsourcedWidgetTypes = {
  [T in SnapshotWidgetType]: [SourceOf<T>] extends [never] ? T : never;
}[SnapshotWidgetType];
const _everyWidgetHasASource: [UnsourcedWidgetTypes] extends [never]
  ? true
  : never = true;
void _everyWidgetHasASource;

/** Runtime counterpart of `SourceOf`, for code that only has a string. */
export function snapshotSourceOf(type: SnapshotWidgetType): SnapshotSource {
  if (type === "status-board") return "status-board";
  const prefix = type.slice(0, type.indexOf("-"));
  if (isSnapshotProvider(prefix)) return prefix;
  // Unreachable for a real WidgetType (`SourceOf` proves it at compile time);
  // a string from an old database row is the only way here.
  throw new Error(`No snapshot source for widget type "${type}"`);
}

/* ─────────────────────────────── reading ──────────────────────────────── */

const optionalString = (value: unknown): string | null | undefined =>
  typeof value === "string" || value === null ? value : undefined;

/**
 * The sync state off a payload, checked field by field.
 *
 * This is the part of the envelope the frame acts on — a `disabled` flag hides
 * the widget behind a reconnect prompt — so it is read defensively rather than
 * trusted: a malformed `_sync` degrades to "no sync information", never to a
 * frame that throws.
 */
export function readSyncMeta(payload: WirePayload): SyncMeta | undefined {
  const raw = payload._sync;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;

  const meta: SyncMeta = {};
  const fetchedAt = optionalString(record.fetchedAt);
  if (fetchedAt !== undefined) meta.fetchedAt = fetchedAt;
  if (typeof record.stale === "boolean") meta.stale = record.stale;
  if (typeof record.disabled === "boolean") meta.disabled = record.disabled;
  const lastError = optionalString(record.lastError);
  if (lastError !== undefined) meta.lastError = lastError;
  if (typeof record.connectionId === "string") {
    meta.connectionId = record.connectionId;
  }
  const connectionLabel = optionalString(record.connectionLabel);
  if (connectionLabel !== undefined) meta.connectionLabel = connectionLabel;
  return meta;
}

/** The envelope around a payload, with provider data left out. */
export function readEnvelope(payload: WirePayload): SnapshotEnvelope {
  return {
    _v: typeof payload._v === "number" ? payload._v : undefined,
    _sync: readSyncMeta(payload),
    _demo: payload._demo === true,
    needsConnection: Boolean(payload.needsConnection),
    provider: typeof payload.provider === "string" ? payload.provider : undefined,
  };
}
