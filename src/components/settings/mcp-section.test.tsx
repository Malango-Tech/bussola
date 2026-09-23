// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FORBIDDEN, forbidden, mockFetch, renderAs, sentBody } from "@/test/render";
import { McpSection } from "./mcp-section";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TOKENS = {
  canUseMcp: true,
  planName: "Self-hosted",
  tokens: [
    {
      id: "tok_1",
      name: "Claude Desktop",
      tokenPrefix: "bsk_abcd",
      scope: "read",
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

/** GET answers with the token list; anything else with `onWrite`. */
function api(onWrite: () => Response = () => Response.json({ ok: true })) {
  return mockFetch((url, init) =>
    (init?.method ?? "GET") === "GET" ? Response.json(TOKENS) : onWrite(),
  );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("McpSection, as a member", () => {
  it("lists tokens but offers neither creating nor revoking one", async () => {
    api();
    renderAs("member", <McpSection />);
    expect(await screen.findByText("Claude Desktop")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create token" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Only an owner or admin can create or revoke MCP tokens/)).toBeInTheDocument();
  });
});

describe("McpSection, as an admin", () => {
  it("creates a token and shows it once, with a config to paste", async () => {
    const fetch = api(() => Response.json({ token: "bsk_fresh_secret" }, { status: 201 }));
    renderAs("admin", <McpSection />);

    await userEvent.type(await screen.findByLabelText("Name"), "Cursor");
    await userEvent.selectOptions(screen.getByLabelText("Access"), "write");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));

    expect(await screen.findByLabelText("New token")).toHaveValue("bsk_fresh_secret");
    expect(screen.getByRole("status")).toHaveTextContent(/not shown again/);
    const post = fetch.mock.calls.findIndex(([, init]) => init?.method === "POST");
    expect(sentBody(fetch, post)).toEqual({ name: "Cursor", scope: "write" });
  });

  it("shows the server's refusal when creating is forbidden", async () => {
    api(() => forbidden());
    renderAs("admin", <McpSection />);
    await userEvent.type(await screen.findByLabelText("Name"), "Cursor");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(FORBIDDEN));
    expect(screen.queryByLabelText("New token")).not.toBeInTheDocument();
  });

  it("revokes, and says why when the server will not", async () => {
    const fetch = api(() => forbidden());
    renderAs("admin", <McpSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke Claude Desktop" }));
    expect(fetch).toHaveBeenCalledWith("/api/tokens?id=tok_1", { method: "DELETE" });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(FORBIDDEN));
  });
});
