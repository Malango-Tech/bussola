import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { read, request } from "@/test/http";
import { reposFor, seedTenants, type Actor, type Tenants } from "@/test/tenant";

/*
 * The MCP endpoint authenticates by bearer token, not by session, so nothing
 * here is mocked: a token is minted into the real table and resolved by the
 * real lookup, exactly as an agent's request would be.
 */
type RpcResponse = {
  jsonrpc: "2.0";
  id: unknown;
  result?: { protocolVersion?: string; tools?: unknown[]; content?: Array<{ text: string }> };
  error?: { code: number; message: string };
};

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let token: string;
let resetRateLimits: () => void;
let mintToken: typeof import("@/lib/sharing/tokens").mintToken;

async function mint(actor: Actor, scope: "read" | "write" = "read") {
  const minted = mintToken("bsk");
  const row = await (await reposFor(actor)).apiTokens.create({
    name: "agent",
    tokenHash: minted.hash,
    tokenPrefix: minted.prefix,
    scope,
    expiresAt: null,
  });
  return { token: minted.token, id: row.id };
}

const rpc = (method: string, params?: Record<string, unknown>, id: unknown = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params ? { params } : {}),
});

const call = (body: unknown, bearer: string | null = token) =>
  route.POST(
    request("/api/mcp", {
      method: "POST",
      body,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    }),
  );

beforeAll(async () => {
  testDb = await startTestDb("mcp-route");
  t = await seedTenants(testDb);
  ({ resetRateLimits } = await import("@/lib/http/rate-limit"));
  ({ mintToken } = await import("@/lib/sharing/tokens"));

  await (await reposFor(t.acme.owner)).dashboards.create("Acme board");
  await (await reposFor(t.other.owner)).dashboards.create("Other board");
  token = (await mint(t.acme.admin)).token;

  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => resetRateLimits());

describe("GET /api/mcp", () => {
  it("declines to open a server-to-client stream", () => {
    const res = route.GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

describe("POST /api/mcp", () => {
  it("answers 401 without a bearer token, and says what is wanted", async () => {
    const res = await call(rpc("initialize"), null);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
  });

  it("answers 401 to a malformed or unknown token", async () => {
    expect((await call(rpc("initialize"), "not-a-token")).status).toBe(401);
    expect((await call(rpc("initialize"), mintToken("bsk").token)).status).toBe(401);
  });

  it("stops accepting a token the moment it is revoked", async () => {
    const minted = await mint(t.acme.admin);
    expect((await call(rpc("initialize"), minted.token)).status).toBe(200);
    await (await reposFor(t.acme.admin)).apiTokens.revoke(minted.id);
    expect((await call(rpc("initialize"), minted.token)).status).toBe(401);
  });

  it("initializes with a valid token", async () => {
    const { status, body } = await read<RpcResponse>(call(rpc("initialize")));
    expect(status).toBe(200);
    expect(body.result?.protocolVersion).toBeTruthy();
  });

  it("answers a JSON-RPC parse error to a body that is not JSON", async () => {
    const { status, body } = await read<RpcResponse>(call("{nope"));
    expect(status).toBe(400);
    expect(body.error?.code).toBe(-32700);
  });

  it("answers 202 with no body to a notification", async () => {
    const res = await call({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("answers a batch in kind", async () => {
    const { status, body } = await read<RpcResponse[]>(
      call([rpc("initialize", undefined, 1), rpc("tools/list", undefined, 2)]),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((response) => response.id)).toEqual([1, 2]);
  });

  it("only ever sees the token's own organization", async () => {
    const { body } = await read<RpcResponse>(
      call(rpc("tools/call", { name: "list_dashboards", arguments: {} })),
    );
    const text = body.result?.content?.map((part) => part.text).join("\n") ?? "";
    expect(text).toContain("Acme board");
    expect(text).not.toContain("Other board");
  });
});
