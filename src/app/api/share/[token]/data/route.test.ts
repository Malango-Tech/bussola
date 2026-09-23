import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createId } from "@/lib/id";

/**
 * A share link returns what its dashboard shows, and nothing next to it.
 *
 * Seeded against a real PGlite: one organization with two Qonto accounts, a
 * snapshot for each, and dashboards that share different slices of them. The
 * assertions are about what a recipient can reach by editing the query string
 * — the only thing they control.
 */
let GET: (
  request: Request,
  context: { params: Promise<{ token: string }> },
) => Promise<Response>;
let dataDir: string;
let closeDb: () => Promise<void>;
let resetRateLimits: () => void;

let defaultConnection: string;
let secondConnection: string;
let balanceOnlyToken: string;
let boundToSecondToken: string;

const SNAPSHOT = {
  _v: 1,
  balances: [{ accountName: "Main", balance: 1000, currency: "EUR" }],
  liquidity: { currency: "EUR", booked: 1000, available: 900 },
  cashflow30d: { currency: "EUR", inflow: 5000, outflow: 4000 },
  balanceHistory: { currency: "EUR", days: 30, points: [] },
};

async function get(token: string, query: Record<string, string>) {
  const url = new URL(`http://localhost/api/share/${token}/data`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await GET(new Request(url), {
    params: Promise.resolve({ token }),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bussola-share-route-"));
  process.env.BUSSOLA_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  delete process.env.BUSSOLA_EDITION;

  const dbModule = await import("@/lib/db");
  await dbModule.runMigrations();
  closeDb = dbModule.closeDb;
  const db = await dbModule.getDb();
  const schema = await import("@/lib/db/schema");
  const { forTenant } = await import("@/lib/db/tenant");
  const { mintToken } = await import("@/lib/sharing/tokens");
  const { encryptSecret } = await import("@/lib/crypto/vault");
  ({ resetRateLimits } = await import("@/lib/http/rate-limit"));

  const organizationId = createId("org");
  const userId = createId("usr");
  await db
    .insert(schema.organization)
    .values({ id: organizationId, name: "Acme", slug: `acme-${organizationId}` });
  await db
    .insert(schema.user)
    .values({ id: userId, name: "Owner", email: "owner@example.test" });
  const repos = forTenant({ organizationId, userId });

  const connect = async (label: string) => {
    const connection = await repos.connections.create({
      provider: "qonto",
      label,
      credentialsEncrypted: encryptSecret(JSON.stringify({ login: "x", secretKey: "y" })),
    });
    await db.insert(schema.connectionSnapshots).values({
      id: createId("snp"),
      organizationId,
      connectionId: connection.id,
      kind: "dashboard",
      payloadJson: JSON.stringify({ ...SNAPSHOT, label }),
    });
    return connection.id;
  };
  // Created first, so it is the provider's default.
  defaultConnection = await connect("Default account");
  secondConnection = await connect("Second account");

  const share = async (
    widgets: Array<{ type: string; connectionId: string | null }>,
  ) => {
    const dashboard = await repos.dashboards.create("Shared");
    for (const widget of widgets) {
      await repos.widgets.add({
        dashboardId: dashboard.id,
        widgetType: widget.type,
        title: widget.type,
        configJson: "{}",
        connectionId: widget.connectionId,
        layoutY: 0,
        layoutW: 4,
        layoutH: 3,
      });
    }
    const minted = mintToken("shr");
    await repos.shares.create({
      dashboardId: dashboard.id,
      tokenHash: minted.hash,
      tokenPrefix: minted.prefix,
      label: null,
      whiteLabel: false,
      expiresAt: null,
    });
    return minted.token;
  };

  balanceOnlyToken = await share([{ type: "qonto-balance", connectionId: null }]);
  boundToSecondToken = await share([
    { type: "qonto-balance", connectionId: secondConnection },
  ]);

  ({ GET } = await import("./route"));
}, 60_000);

beforeEach(() => resetRateLimits());

afterAll(async () => {
  await closeDb?.();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("GET /api/share/[token]/data", () => {
  it("serves the shared widget", async () => {
    const { status, body } = await get(balanceOnlyToken, { type: "qonto-balance" });
    expect(status).toBe(200);
    expect(body.balances).toEqual(SNAPSHOT.balances);
    expect(body.liquidity).toEqual(SNAPSHOT.liquidity);
  });

  it("trims the snapshot to the fields the shared widgets read", async () => {
    const { body } = await get(balanceOnlyToken, { type: "qonto-balance" });
    expect(body).not.toHaveProperty("cashflow30d");
    expect(body).not.toHaveProperty("balanceHistory");
    expect(body).not.toHaveProperty("label");
    // Frame metadata survives.
    expect(body._sync).toMatchObject({ connectionId: defaultConnection });
  });

  it("returns the same trimmed snapshot whichever type of the provider is asked for", async () => {
    const { status, body } = await get(balanceOnlyToken, { type: "qonto-cashflow" });
    expect(status).toBe(200);
    expect(body).not.toHaveProperty("cashflow30d");
  });

  it("refuses live bank transactions unless that exact widget is shared", async () => {
    const { status } = await get(balanceOnlyToken, {
      type: "qonto-transactions",
      limit: "100",
    });
    expect(status).toBe(403);
  });

  it("refuses the provider default when the dashboard binds a specific account", async () => {
    const { status } = await get(boundToSecondToken, { type: "qonto-balance" });
    expect(status).toBe(403);
  });

  it("refuses a connection the dashboard does not bind", async () => {
    const { status } = await get(boundToSecondToken, {
      type: "qonto-balance",
      connectionId: defaultConnection,
    });
    expect(status).toBe(403);
  });

  it("serves the account the dashboard does bind", async () => {
    const { status, body } = await get(boundToSecondToken, {
      type: "qonto-balance",
      connectionId: secondConnection,
    });
    expect(status).toBe(200);
    expect(body._sync).toMatchObject({ connectionId: secondConnection });
  });

  it("refuses a provider that is not on the dashboard", async () => {
    const { status } = await get(balanceOnlyToken, { type: "stripe-mrr" });
    expect(status).toBe(403);
  });

  it("answers a malformed or unknown token with 404", async () => {
    expect((await get("not-a-token", { type: "qonto-balance" })).status).toBe(404);
    const { mintToken } = await import("@/lib/sharing/tokens");
    expect((await get(mintToken("shr").token, { type: "qonto-balance" })).status).toBe(404);
  });
});
