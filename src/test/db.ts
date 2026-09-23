import fs from "fs";
import os from "os";
import path from "path";
import { createId } from "@/lib/id";

/**
 * A real Postgres (PGlite) with the real migrations, for route tests.
 *
 * Route handlers are barred from touching the database directly, and so are
 * the tests that sit next to them — the lint rule cannot tell the two apart.
 * Seeding rows the repositories have no writer for (organizations, members,
 * snapshots, fired alerts) happens here instead, outside `src/app`.
 *
 * Every module that reads the environment is imported dynamically, after the
 * data directory is set, so each test file gets its own throwaway database.
 */
export type TestDb = Awaited<ReturnType<typeof startTestDb>>;

export async function startTestDb(label: string) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `bussola-${label}-`));
  process.env.BUSSOLA_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  delete process.env.BUSSOLA_EDITION;

  const dbModule = await import("@/lib/db");
  await dbModule.runMigrations();
  const db = await dbModule.getDb();
  const schema = await import("@/lib/db/schema");

  return {
    db,
    schema,

    async close() {
      await dbModule.closeDb();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },

    /** An organization with nobody in it yet. */
    async organization(name = "Acme"): Promise<string> {
      const id = createId("org");
      await db
        .insert(schema.organization)
        .values({ id, name, slug: `${name.toLowerCase()}-${id}` });
      return id;
    },

    /** An account and its membership, as Better Auth would have written them. */
    async person(organizationId: string, role: string, name = role) {
      const userId = createId("usr");
      const memberId = createId("mem");
      const email = `${name}-${userId}@example.test`;
      await db.insert(schema.user).values({ id: userId, name, email });
      await db
        .insert(schema.member)
        .values({ id: memberId, organizationId, userId, role });
      return { userId, memberId, email, name };
    },

    /** What the sync worker would have stored for a connection. */
    async snapshot(
      organizationId: string,
      connectionId: string,
      payload: Record<string, unknown>,
    ) {
      await db.insert(schema.connectionSnapshots).values({
        id: createId("snp"),
        organizationId,
        connectionId,
        kind: "dashboard",
        payloadJson: JSON.stringify(payload),
      });
    },

    /** A notification the alert runner would have recorded. */
    async alertEvent(
      organizationId: string,
      ruleId: string,
      state: "breached" | "ok" = "breached",
    ) {
      const id = createId("evt");
      await db.insert(schema.alertEvents).values({
        id,
        organizationId,
        ruleId,
        state,
        value: "42",
        message: state === "breached" ? "Something crossed a line" : "Back to normal",
      });
      return id;
    },
  };
}
