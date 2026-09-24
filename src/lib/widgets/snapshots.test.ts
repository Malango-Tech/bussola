import { describe, expect, expectTypeOf, it } from "vitest";
import { fetchDashboardSnapshot, isSyncable } from "@/lib/sync/providers";
import { PAYLOAD_VERSION } from "@/lib/sync/config";
import { WIDGET_REGISTRY } from "./registry";
import {
  READ_THROUGH_TYPES,
  SNAPSHOT_PROVIDERS,
  isReadThroughType,
  isSnapshotProvider,
  readEnvelope,
  readSyncMeta,
  snapshotSourceOf,
  type QontoSnapshot,
  type RailwaySnapshot,
  type ServedSnapshot,
  type SourceOf,
} from "./snapshots";

describe("snapshot providers", () => {
  it("are exactly the providers the worker can sync", () => {
    for (const provider of SNAPSHOT_PROVIDERS) {
      expect(isSyncable(provider), provider).toBe(true);
      expect(PAYLOAD_VERSION[provider], provider).toBeGreaterThan(0);
    }
    expect(isSyncable("github")).toBe(false);
    expect(isSnapshotProvider("github")).toBe(false);
    expect(isSnapshotProvider("railway")).toBe(true);
  });

  it("refuses a provider with no connector at runtime too", async () => {
    // What a stale database row would pass, whatever the types say.
    const unknown = "github" as unknown as "railway";
    await expect(fetchDashboardSnapshot(unknown, {})).rejects.toThrow(
      'No connector for provider "github"',
    );
  });

  it("types each fetch as that provider's snapshot", () => {
    expectTypeOf(fetchDashboardSnapshot<"railway">).returns.resolves.toEqualTypeOf<RailwaySnapshot>();
    expectTypeOf(fetchDashboardSnapshot<"qonto">).returns.resolves.toEqualTypeOf<QontoSnapshot>();
  });
});

describe("widget ↔ source", () => {
  it("maps every snapshot widget to a source, and only read-through ones to none", () => {
    for (const { type } of WIDGET_REGISTRY) {
      if (isReadThroughType(type)) {
        expect(READ_THROUGH_TYPES).toContain(type);
        continue;
      }
      const source = snapshotSourceOf(type);
      expect(source === "status-board" || isSnapshotProvider(source), type).toBe(true);
    }
  });

  it("resolves sources from the type name at compile time", () => {
    expectTypeOf<SourceOf<"lemonsqueezy-mrr">>().toEqualTypeOf<"lemonsqueezy">();
    expectTypeOf<SourceOf<"supabase-advisor-issues">>().toEqualTypeOf<"supabase">();
    expectTypeOf<SourceOf<"status-board">>().toEqualTypeOf<"status-board">();
    // Every top-level field may be missing from what a widget is served.
    expectTypeOf<ServedSnapshot<"railway">["fleet"]>().toEqualTypeOf<
      RailwaySnapshot["fleet"] | undefined
    >();
  });

  it("refuses a string that is not a widget type", () => {
    const retired = "uptime-robot-monitors" as unknown as "railway-fleet";
    expect(() => snapshotSourceOf(retired)).toThrow(/No snapshot source/);
  });
});

describe("readSyncMeta", () => {
  it("reads the fields the server writes", () => {
    expect(
      readSyncMeta({
        _sync: {
          fetchedAt: "2026-09-01T10:00:00.000Z",
          stale: true,
          disabled: false,
          lastError: null,
          connectionId: "c1",
          connectionLabel: "Prod",
        },
      }),
    ).toEqual({
      fetchedAt: "2026-09-01T10:00:00.000Z",
      stale: true,
      disabled: false,
      lastError: null,
      connectionId: "c1",
      connectionLabel: "Prod",
    });
  });

  it("drops fields of the wrong type rather than trusting them", () => {
    expect(
      readSyncMeta({ _sync: { stale: "yes", disabled: 1, lastError: 42, fetchedAt: {} } }),
    ).toEqual({});
  });

  it("is absent when there is no usable sync block", () => {
    expect(readSyncMeta({})).toBeUndefined();
    expect(readSyncMeta({ _sync: null })).toBeUndefined();
    expect(readSyncMeta({ _sync: [] })).toBeUndefined();
    expect(readSyncMeta({ _sync: "stale" })).toBeUndefined();
  });
});

describe("readEnvelope", () => {
  it("separates metadata from provider data", () => {
    expect(
      readEnvelope({
        _v: 2,
        _demo: true,
        provider: "railway",
        fleet: { healthy: 1 },
      }),
    ).toEqual({
      _v: 2,
      _sync: undefined,
      _demo: true,
      needsConnection: false,
      provider: "railway",
    });
  });

  it("only counts an explicit true as demo data", () => {
    expect(readEnvelope({ _demo: "true" })._demo).toBe(false);
    expect(readEnvelope({ needsConnection: true }).needsConnection).toBe(true);
    expect(readEnvelope({ provider: 7 }).provider).toBeUndefined();
  });
});
