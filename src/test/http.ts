/**
 * Calling route handlers the way Next does, without a server.
 *
 * Handlers are plain functions of a `Request` (and, for dynamic segments, a
 * `{ params: Promise<…> }` context), so a test builds the request, awaits the
 * handler and reads the JSON back.
 */
const ORIGIN = "http://localhost";

export function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const { method = "GET", body, headers = {} } = init;
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers:
      body === undefined
        ? headers
        : { "Content-Type": "application/json", ...headers },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

/** The route context for a dynamic segment; Next passes params as a promise. */
export function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

/**
 * Status and parsed body. `T` is the shape the test expects, not a checked
 * one: a wrong guess fails the assertion that relies on it.
 */
export async function read<T extends object = Record<string, unknown>>(
  response: Response | Promise<Response>,
): Promise<{ status: number; body: T & { error?: string } }> {
  const res = await response;
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : {}) as T & { error?: string },
  };
}
