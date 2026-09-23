import fs from "fs";
import path from "path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { assertEditionConfig } from "@/lib/edition";
import { dataDir, env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Both editions speak Postgres, so there is exactly one schema, one migration
 * set and one query dialect.
 *
 * `DATABASE_URL` selects a real Postgres server (cloud, or a self-hoster who
 * brought their own). With no URL we fall back to PGlite — Postgres compiled to
 * WASM, stored as a directory on disk — so `npm run dev` still needs no daemon
 * and no Docker. PGlite is single-process by design: it suits one person
 * running Bussola locally, not a shared deployment. Set DATABASE_URL for that.
 */
export type BussolaDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * The handle inside `db.transaction(...)`, for helpers that must run in the
 * caller's transaction. Reaching for `getDb()` from inside one would open a
 * second connection on Postgres — and wait forever on PGlite, whose single
 * connection the transaction is holding.
 */
export type BussolaTx = Parameters<Parameters<BussolaDb["transaction"]>[0]>[0];

type Handle = {
  db: BussolaDb;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
};

const globalForDb = globalThis as unknown as {
  __bussolaDb?: Promise<Handle>;
};

function migrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

export function databaseUrl(): string | undefined {
  return env().DATABASE_URL;
}

function pgliteDataDir(): string {
  return path.join(dataDir(), "pgdata");
}

async function createHandle(): Promise<Handle> {
  assertEditionConfig();

  const url = databaseUrl();

  if (url) {
    const [{ Pool }, { drizzle }, { migrate }] = await Promise.all([
      import("pg"),
      import("drizzle-orm/node-postgres"),
      import("drizzle-orm/node-postgres/migrator"),
    ]);

    const pool = new Pool({
      connectionString: url,
      max: env().DATABASE_POOL_MAX,
      // Managed Postgres (Supabase, Neon) terminates idle clients; keep the
      // pool small and let it recycle rather than holding dead sockets.
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    const db = drizzle(pool, { schema });
    return {
      db: db as unknown as BussolaDb,
      migrate: () => migrate(db, { migrationsFolder: migrationsFolder() }),
      close: () => pool.end(),
    };
  }

  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);

  const dir = pgliteDataDir();
  // PGlite does not create intermediate directories itself.
  fs.mkdirSync(dir, { recursive: true });

  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as BussolaDb,
    migrate: () => migrate(db, { migrationsFolder: migrationsFolder() }),
    close: () => client.close(),
  };
}

function handle(): Promise<Handle> {
  globalForDb.__bussolaDb ??= createHandle();
  return globalForDb.__bussolaDb;
}

export async function getDb(): Promise<BussolaDb> {
  return (await handle()).db;
}

export async function runMigrations(): Promise<void> {
  await (await handle()).migrate();
}

export async function closeDb(): Promise<void> {
  const existing = globalForDb.__bussolaDb;
  if (!existing) return;
  globalForDb.__bussolaDb = undefined;
  await (await existing).close();
}

export { schema };
