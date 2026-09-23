import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { RoleProvider } from "@/components/providers/role-provider";
import type { MemberRole } from "@/lib/auth/roles";

/**
 * Component-test helpers. jsdom only: import from a file that starts with
 * `// @vitest-environment jsdom`.
 */

/** Render as someone with `role`, the way AppShell mounts every screen. */
export function renderAs(role: MemberRole, ui: ReactElement) {
  return render(<RoleProvider role={role}>{ui}</RoleProvider>);
}

type Handler = (
  url: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

/**
 * Replace `fetch` for the rest of the test with one answered by `handler`.
 * Returns the spy, so a test can assert on what was sent.
 */
export function mockFetch(handler: Handler) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The parsed JSON body of the `n`th call to a fetch spy. */
export function sentBody(spy: ReturnType<typeof mockFetch>, n: number): unknown {
  const init = spy.mock.calls[n]?.[1];
  return typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
}

/** The refusal `withTenant` sends a role that is not enough. */
export const FORBIDDEN = "Only an owner or admin of this organization can do that.";

export function forbidden(message = FORBIDDEN) {
  return Response.json({ error: message }, { status: 403 });
}
