import { NextResponse } from "next/server";
import { entitlementsFor } from "@/lib/billing/entitlements";
import {
  LIMITS,
  callerAddress,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/http/rate-limit";
import { bearerFrom, resolveApiToken } from "@/lib/mcp/auth";
import { hashToken, looksLikeToken } from "@/lib/sharing/tokens";
import {
  PROTOCOL_VERSION,
  handleMessage,
  parseError,
  type JsonRpcResponse,
} from "@/lib/mcp/server";

export const runtime = "nodejs";

/**
 * The MCP endpoint.
 *
 * Streamable HTTP, minus the streaming: every message is a complete request
 * with its own bearer token and a complete response. There is no session to
 * hijack and nothing held open, which is what makes this safe to expose on a
 * serverless deployment as well as a long-lived server.
 *
 * The token is resolved on every single call, never cached — revoking one
 * takes effect on the agent's next request rather than whenever some session
 * happens to end.
 */
export async function POST(request: Request) {
  const bearer = bearerFrom(request);

  /*
   * Two limits, because the two failure modes are different.
   *
   * A request with no usable token is either a misconfigured client or someone
   * guessing, so it is metered hard and by address — before the database is
   * touched, so guessing costs the guesser more than it costs us. A request
   * with a real token is metered by that token, generously: an agent doing
   * real work makes bursts of tool calls.
   */
  if (!bearer) {
    const anonymous = rateLimit(
      `mcp-anon:${callerAddress(request)}`,
      LIMITS.mcpAnonymous,
    );
    if (!anonymous.ok) return tooMany(anonymous);
    return unauthorized();
  }

  // Only a token shaped like ours gets its own bucket (a malformed one is
  // guessing and is metered by address), and the bucket is keyed by its hash
  // so the limiter never holds a live credential in memory.
  if (!looksLikeToken(bearer)) {
    const anonymous = rateLimit(
      `mcp-anon:${callerAddress(request)}`,
      LIMITS.mcpAnonymous,
    );
    if (!anonymous.ok) return tooMany(anonymous);
    return unauthorized();
  }

  const limited = rateLimit(`mcp:${hashToken(bearer)}`, LIMITS.mcp);
  if (!limited.ok) return tooMany(limited);

  const principal = await resolveApiToken(bearer);
  if (!principal) {
    // An unrecognised token is guessing too, whatever shape it had.
    const anonymous = rateLimit(
      `mcp-anon:${callerAddress(request)}`,
      LIMITS.mcpAnonymous,
    );
    if (!anonymous.ok) return tooMany(anonymous);
    return unauthorized();
  }

  // Checked per request, so a downgrade closes the door on the next call
  // rather than at the end of a billing period.
  const entitlements = await entitlementsFor(principal.organizationId);
  if (!entitlements.features.mcp) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32003,
          message: `The MCP server is not part of the ${entitlements.planName} plan.`,
        },
      },
      { status: 402 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(parseError(), { status: 400 });
  }

  /*
   * A batch is an array; a single call is an object. Both are answered in
   * kind, and notifications inside a batch contribute no response — so a
   * batch of nothing but notifications correctly answers 202 with no body.
   */
  if (Array.isArray(body)) {
    const responses = (
      await Promise.all(body.map((message) => handleMessage(principal, message)))
    ).filter((response): response is JsonRpcResponse => response !== null);

    return responses.length === 0
      ? new NextResponse(null, { status: 202 })
      : NextResponse.json(responses);
  }

  const response = await handleMessage(principal, body);
  return response === null
    ? new NextResponse(null, { status: 202 })
    : NextResponse.json(response);
}

/**
 * A GET is how a client opens the server-to-client stream.
 *
 * This server never initiates a message, so it declines rather than holding a
 * connection open that would only ever be idle. 405 with `Allow` is what the
 * spec prescribes for exactly this case.
 */
export function GET() {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "POST", "MCP-Protocol-Version": PROTOCOL_VERSION },
  });
}

function tooMany(result: ReturnType<typeof rateLimit>) {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        // -32002 is the conventional "server busy" in JSON-RPC practice; the
        // HTTP 429 is what a transport-aware client will actually act on.
        code: -32002,
        message: `Rate limit reached. Retry in ${result.retryAfter}s.`,
      },
    },
    { status: 429, headers: rateLimitHeaders(result) },
  );
}

function unauthorized() {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32001,
        message:
          "Missing or invalid bearer token. Create one in Bussola under Settings → MCP.",
      },
    },
    {
      status: 401,
      // Tells a spec-compliant client that a bearer token is what is wanted,
      // rather than leaving it to guess from the message.
      headers: { "WWW-Authenticate": 'Bearer realm="bussola"' },
    },
  );
}
