import { and, eq, lt } from "drizzle-orm";
import { createId } from "@/lib/id";
import { logger } from "@/lib/log";
import { getDb } from "..";
import { connectionCache } from "../schema";

const log = logger("cache");

const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

/** Drop expired rows at most once per minute, off the read hot path. */
async function sweepExpired() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const db = await getDb();
  await db
    .delete(connectionCache)
    .where(lt(connectionCache.expiresAt, new Date(now)));
}

/**
 * The per-organization read-through cache.
 *
 * Takes a bare organization id, like `snapshotRepo`: a cache entry belongs to
 * the tenant, not to whoever happened to fill it.
 */
export function cacheRepo(org: string) {
  async function readRow<T>(cacheKey: string) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(connectionCache)
      .where(
        and(
          eq(connectionCache.cacheKey, cacheKey),
          eq(connectionCache.organizationId, org),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      payload: JSON.parse(row.payloadJson) as T,
      expired: row.expiresAt < new Date(),
    };
  }

  async function set(cacheKey: string, payload: unknown, ttlSeconds: number) {
    const db = await getDb();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const payloadJson = JSON.stringify(payload);

    await db
      .insert(connectionCache)
      .values({
        id: createId("cch"),
        organizationId: org,
        cacheKey,
        payloadJson,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [connectionCache.organizationId, connectionCache.cacheKey],
        set: { payloadJson, expiresAt },
      });
  }

  return {
    set,

    async get<T>(cacheKey: string): Promise<T | null> {
      await sweepExpired();
      const row = await readRow<T>(cacheKey);
      return row && !row.expired ? row.payload : null;
    },

    /**
     * Read-through cache. A fresh hit is returned as-is; a miss awaits the
     * fetch.
     *
     * Note the deliberate absence of stale-while-revalidate: the previous
     * implementation kicked off an un-awaited background refresh, which a
     * serverless runtime is free to freeze the moment the response is sent, so
     * the refresh silently never landed. Phase 2 replaces this with a
     * background sync worker; until then a stale entry is refreshed inline.
     */
    async fetch<T>(
      cacheKey: string,
      ttlSeconds: number,
      fetcher: () => Promise<T>,
    ): Promise<{ data: T; cached: boolean }> {
      await sweepExpired();
      const row = await readRow<T>(cacheKey);
      if (row && !row.expired) {
        return { data: row.payload, cached: true };
      }

      try {
        const data = await fetcher();
        await set(cacheKey, data, ttlSeconds);
        return { data, cached: false };
      } catch (error) {
        // Serving a stale payload beats showing an error for a transient blip
        // — but the reader cannot tell, so the failure is logged here or not
        // at all.
        if (row) {
          log.warn(
            "fetch failed; serving stale cache entry",
            { organizationId: org, cacheKey },
            error,
          );
          return { data: row.payload, cached: true };
        }
        throw error;
      }
    },
  };
}
