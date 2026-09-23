import { logger, type Logger } from "@/lib/log";
import type { Provider } from "@/lib/providers";

/**
 * Logging for connector fallbacks.
 *
 * Connectors deliberately turn many sub-request failures into an empty
 * section rather than a failed dashboard. That is right for the user and
 * wrong for whoever later asks why the section is empty, so each fallback
 * leaves a line: `debug` where the failure is an expected consequence of a
 * token's scope or plan (a probe for the wrong token kind, billing a member
 * cannot see), `warn` where a section the user relies on silently went blank.
 *
 * Fields carry ids and the provider's error message — never credentials. The
 * messages come from `fetchJson`, which quotes the provider's response body
 * and never the request headers that carry the token.
 */
export function connectorLogger(provider: Provider): Logger {
  return logger(`connector:${provider}`);
}

/**
 * An error as a log field. `debug` entries take fields only, and for an
 * expected fallback the message is what is worth reading, not the stack.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
