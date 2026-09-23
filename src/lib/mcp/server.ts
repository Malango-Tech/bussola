import { logger } from "@/lib/log";
import type { McpPrincipal } from "./auth";
import { TOOLS, callTool } from "./tools";

const log = logger("mcp");

/**
 * A minimal Model Context Protocol server, over JSON-RPC 2.0.
 *
 * Written directly against the wire format rather than pulling in an SDK: the
 * streamable-HTTP surface a stateless tool server actually needs is four
 * methods, and hand-rolling them keeps the dependency count — and therefore
 * the audit surface of something that answers to a bearer token — where it is.
 *
 * Stateless by design. There is no session to resume, no server-initiated
 * message, and no subscription: every request carries its own token and is
 * answered on its own. That makes it safe to run on serverless, where a
 * long-lived SSE stream would be cut mid-conversation anyway.
 */

/** The revision this server implements. */
export const PROTOCOL_VERSION = "2025-06-18";

export const SERVER_INFO = {
  name: "bussola",
  title: "Bussola",
  version: "1.0.0",
} as const;

type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** JSON-RPC's own codes. Tool failures are not these — see `handleToolCall`. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

function result(id: JsonRpcId, value: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result: value };
}

function failure(
  id: JsonRpcId,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function isNotification(message: JsonRpcRequest): boolean {
  // A JSON-RPC notification has no id and expects no reply.
  return message.id === undefined;
}

export async function handleMessage(
  principal: McpPrincipal,
  message: unknown,
): Promise<JsonRpcResponse | null> {
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    typeof (message as JsonRpcRequest).method !== "string"
  ) {
    return failure(null, INVALID_REQUEST, "Not a JSON-RPC request");
  }

  const request = message as JsonRpcRequest;
  const id = request.id ?? null;

  try {
    switch (request.method) {
      case "initialize":
        return result(id, {
          /*
           * Our version, not the client's, echoed back.
           *
           * The spec allows a server to answer with a version it supports when
           * the client asked for another; the client then decides whether to
           * continue. Echoing whatever was asked for would be a claim to speak
           * a revision this code has never seen.
           */
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            // No listChanged: the tool list is compiled in and cannot change
            // under a running client, so advertising notifications we will
            // never send would be a lie a client might wait on.
            tools: {},
          },
          serverInfo: SERVER_INFO,
          instructions:
            "Bussola exposes one organization's connected infrastructure and finance data. " +
            "Reads come from stored snapshots, so they never call the upstream provider. " +
            "Credentials are never readable through this server, and nothing here writes to a third-party system.",
        });

      // Notifications: acknowledged by returning nothing, per the spec.
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "ping":
        return result(id, {});

      case "tools/list":
        return result(id, {
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: {
              readOnlyHint: !tool.mutates,
              // Nothing here deletes data outside Bussola's own tables, and
              // every write is confined to this organization.
              destructiveHint: tool.name === "remove_widget",
              openWorldHint: false,
            },
          })),
        });

      case "tools/call":
        return await handleToolCall(principal, id, request.params ?? {});

      default:
        return failure(
          id,
          METHOD_NOT_FOUND,
          `Method not supported: ${request.method}`,
        );
    }
  } catch (error) {
    log.error(
      "handler failed",
      {
        method: request.method,
        organizationId: principal.organizationId,
        tokenId: principal.tokenId,
      },
      error,
    );
    return failure(id, INTERNAL_ERROR, "Internal error");
  }
}

/**
 * Tool failures are results, not JSON-RPC errors.
 *
 * The distinction matters to a model: a protocol error is a broken connection
 * it should stop using, while `isError: true` is an answer it can read and act
 * on — "that dashboard does not exist", "this token is read-only". Reporting
 * the second as the first makes an agent give up on a recoverable mistake.
 */
async function handleToolCall(
  principal: McpPrincipal,
  id: JsonRpcId,
  params: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const name = params.name;
  if (typeof name !== "string") {
    return failure(id, INVALID_REQUEST, "tools/call requires a tool name");
  }

  const args =
    params.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : {};

  const outcome = await callTool(principal, name, args);

  if (!outcome.ok) {
    return result(id, {
      content: [{ type: "text", text: outcome.error }],
      isError: true,
    });
  }

  const text = JSON.stringify(outcome.data, null, 2);
  return result(id, {
    // Both, deliberately: `structuredContent` is what a client parses, while
    // the text block is what a model without structured-output support reads.
    content: [{ type: "text", text }],
    structuredContent: outcome.data,
    isError: false,
  });
}

export function parseError(id: JsonRpcId = null): JsonRpcResponse {
  return failure(id, PARSE_ERROR, "Invalid JSON");
}
