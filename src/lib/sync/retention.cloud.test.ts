import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createId } from "@/lib/id";

/**
 * History retention as the hosted edition runs it, against a real Postgres.
 *
 * The edition is fixed when `lib/edition` loads, so it is mocked to cloud here
 * rather than set through the environment — which would also demand a
 * Postgres URL and secrets this suite has no use for.
 */
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  EDITION: "cloud",
  isCloud: true,
  isSelfHosted: false,
  assertEditionConfig: () => {},
}));

const DAY = 24 * 60 * 60 * 1000;

let dataDir: string;
let closeDb: () => Promise<void>;
let db: Awaited<ReturnType<typeof import("@/lib/db").getDb>>;
let schema: typeof import("@/lib/db/schema");
let retention: typeof import("./retention");
let entitlements: typeof import("@/lib/billing/entitlements");

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bussola-retention-"));
  process.env.BUSSOLA_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;

  const dbModule = await import("@/lib/db");
  schema = await import("@/lib/db/schema");
  retention = await import("./retention");
  entitlements = await import("@/lib/billing/entitlements");

  await dbModule.runMigrations();
  closeDb = dbModule.closeDb;
  db = await dbModule.getDb();
}, 60_000);

afterAll(async () => {
  await closeDb?.();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** An organization on a plan, with one connection and samples of given ages. */
async function tenant(plan: "trial" | "solo" | "team" | null, ageDays: number[]) {
  const organizationId = createId("org");
  const connectionId = createId("con");
  await db.insert(schema.organization).values({
    id: organizationId,
    name: organizationId,
    slug: organizationId,
  });
  if (plan) {
    await db.insert(schema.subscriptions).values({
      id: createId("sub"),
      organizationId,
      stripeCustomerId: `cus_${organizationId}`,
      plan,
      status: "active",
    });
  }
  await db.insert(schema.connections).values({
    id: connectionId,
    organizationId,
    provider: "railway",
    label: "r",
    credentialsEncrypted: "unused",
  });
  const now = Date.now();
  if (ageDays.length > 0) {
    await db.insert(schema.connectionHistory).values(
      ageDays.map((age) => ({
        id: createId("hst"),
        organizationId,
        connectionId,
        kind: "dashboard",
        payloadJson: "{}",
        // Whole hours, so no two samples collide on the hourly bucket.
        bucket: new Date(Math.floor((now - age * DAY) / 3_600_000) * 3_600_000),
        fetchedAt: new Date(now - age * DAY),
      })),
    );
  }
  return organizationId;
}

async function ages(organizationId: string) {
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({ bucket: schema.connectionHistory.bucket })
    .from(schema.connectionHistory)
    .where(eq(schema.connectionHistory.organizationId, organizationId));
  return rows
    .map((row) => Math.round((Date.now() - row.bucket.getTime()) / DAY))
    .sort((a, b) => a - b);
}

describe("pruneHistory in the hosted edition", () => {
  it("trims every tenant to its own plan's retention, in one pass", async () => {
    // No subscription row: the trial, 7 days.
    const trial = await tenant(null, [1, 6, 8, 40]);
    const solo = await tenant("solo", [1, 20, 31, 100]);
    const team = await tenant("team", [1, 200, 364, 366, 400]);
    const soloToo = await tenant("solo", [2, 45]);

    const report = await retention.pruneHistory();

    expect(await ages(trial)).toEqual([1, 6]);
    expect(await ages(solo)).toEqual([1, 20]);
    expect(await ages(team)).toEqual([1, 200, 364]);
    expect(await ages(soloToo)).toEqual([2]);
    expect(report).toEqual({ organizations: 4, deleted: 7 });
  });

  it("is a no-op when nothing is past retention", async () => {
    const fresh = await tenant("team", [1, 2]);
    const report = await retention.pruneHistory();
    expect(report.deleted).toBe(0);
    expect(await ages(fresh)).toEqual([1, 2]);
  });
});

describe("entitlementsForMany", () => {
  it("matches entitlementsFor for every organization, in one read", async () => {
    const solo = await tenant("solo", []);
    const team = await tenant("team", []);
    const none = await tenant(null, []);

    const many = await entitlements.entitlementsForMany([solo, team, none]);

    expect([...many.keys()]).toEqual([solo, team, none]);
    for (const id of [solo, team, none]) {
      expect(many.get(id)).toEqual(await entitlements.entitlementsFor(id));
    }
    expect(many.get(none)?.plan).toBe("trial");
  });

  it("returns an empty map for no organizations", async () => {
    expect((await entitlements.entitlementsForMany([])).size).toBe(0);
  });
});
