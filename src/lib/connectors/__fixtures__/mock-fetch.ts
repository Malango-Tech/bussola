import { vi } from "vitest";

/**
 * A stand-in for `fetch` that answers from recorded provider responses.
 *
 * Connector tests stub the network rather than `fetchJson`, so the real
 * transport — status handling, the `<Name> API <status>: …` error shape that
 * `toUserFacingError` reads, JSON parsing — is exercised along with the
 * parsing on top of it.
 *
 * Routes are tried in order and the first match answers. A request nothing
 * matches gets a 404 and is recorded in `unmatched`: several connectors turn a
 * failed sub-request into an empty section on purpose, so a missing fixture
 * would otherwise pass as "graceful degradation" instead of failing the test.
 */

export type MockRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON body, when there is one (Railway's GraphQL queries). */
  body?: unknown;
};

export type MockResponse = {
  status?: number;
  /** Serialised as JSON unless it is already a string. */
  body?: unknown;
};

export type MockRoute = {
  match: string | RegExp | ((request: MockRequest) => boolean);
  respond: MockResponse | ((request: MockRequest) => MockResponse);
};

export type FetchMock = {
  calls: MockRequest[];
  unmatched: string[];
  /** Requests whose URL contains `fragment`, in the order they were made. */
  callsTo(fragment: string): MockRequest[];
};

export const ok = (body: unknown): MockResponse => ({ status: 200, body });

export const fail = (status: number, body: unknown = ""): MockResponse => ({
  status,
  body,
});

function matches(route: MockRoute, request: MockRequest): boolean {
  const { match } = route;
  if (typeof match === "string") return request.url.includes(match);
  if (match instanceof RegExp) return match.test(request.url);
  return match(request);
}

function toRequest(input: RequestInfo | URL, init?: RequestInit): MockRequest {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  let body: unknown;
  if (typeof init?.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      // Not JSON (a form-encoded body, say): keep it exactly as sent.
      body = init.body;
    }
  }
  return { url, method: init?.method ?? "GET", headers, body };
}

export function mockFetch(routes: MockRoute[]): FetchMock {
  const calls: MockRequest[] = [];
  const unmatched: string[] = [];

  const fetchStub = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = toRequest(input, init);
      calls.push(request);

      const route = routes.find((candidate) => matches(candidate, request));
      if (!route) {
        unmatched.push(`${request.method} ${request.url}`);
        return new Response("no fixture for this request", { status: 404 });
      }

      const response =
        typeof route.respond === "function"
          ? route.respond(request)
          : route.respond;
      const body =
        typeof response.body === "string"
          ? response.body
          : JSON.stringify(response.body ?? null);
      return new Response(body, {
        status: response.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  vi.stubGlobal("fetch", fetchStub);

  return {
    calls,
    unmatched,
    callsTo: (fragment) => calls.filter((call) => call.url.includes(fragment)),
  };
}

/** A GraphQL route keyed on the query text, for Railway's single endpoint. */
export function graphql(
  pattern: RegExp,
  respond: MockRoute["respond"],
): MockRoute {
  return {
    match: (request) => {
      const query = (request.body as { query?: unknown } | undefined)?.query;
      return typeof query === "string" && pattern.test(query);
    },
    respond,
  };
}

/** The variables a GraphQL request was sent with. */
export function variablesOf(request: MockRequest): Record<string, unknown> {
  const variables = (request.body as { variables?: unknown } | undefined)
    ?.variables;
  return variables && typeof variables === "object"
    ? (variables as Record<string, unknown>)
    : {};
}
