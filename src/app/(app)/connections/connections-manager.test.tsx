// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORBIDDEN, forbidden, mockFetch, renderAs } from "@/test/render";
import { ConnectionsManager, type ConnectionView } from "./connections-manager";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const vercel: ConnectionView = {
  id: "con_vercel",
  provider: "vercel",
  label: "Vercel",
  status: "connected",
  lastError: null,
  syncEnabled: true,
  lastSyncedAt: null,
  consecutiveFailures: 0,
};

const page = (
  <ConnectionsManager
    connections={[vercel]}
    liveProviders={["vercel", "stripe"]}
    comingSoon={[]}
    widgetCounts={{ vercel: 2 }}
  />
);

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConnectionsManager, as a member", () => {
  it("explains why a source cannot be connected, and disables Connect", () => {
    renderAs("member", page);
    const connect = screen.getByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();
    expect(connect).toHaveAccessibleDescription(
      /Only an owner or admin can connect, replace or remove a source/,
    );
  });

  it("hides replace and remove, but keeps refresh and test", () => {
    renderAs("member", page);
    expect(screen.queryByRole("button", { name: /Edit Vercel/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove Vercel/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Vercel" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Test Vercel credentials" })).toBeEnabled();
  });
});

describe("ConnectionsManager, as an admin", () => {
  it("offers every action and no hint", () => {
    renderAs("admin", page);
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Edit Vercel connection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Vercel connection" })).toBeInTheDocument();
    expect(screen.queryByText(/Only an owner or admin/)).not.toBeInTheDocument();
  });

  it("warns what removing will affect, then removes", async () => {
    const fetch = mockFetch(() => Response.json({ ok: true }));
    renderAs("admin", page);
    await userEvent.click(screen.getByRole("button", { name: "Remove Vercel connection" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Remove the Vercel connection? 2 widgets will fall back to demo data.",
    );
    expect(fetch).toHaveBeenCalledWith("/api/connections?id=con_vercel", { method: "DELETE" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Connection removed"));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server's refusal when the role check fails anyway", async () => {
    mockFetch(() => forbidden());
    renderAs("admin", page);
    await userEvent.click(screen.getByRole("button", { name: "Remove Vercel connection" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(FORBIDDEN));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("opens the connect dialog", async () => {
    renderAs("admin", page);
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("dialog", { name: "Connect Stripe" })).toBeInTheDocument();
    expect(screen.getByLabelText("API token")).toHaveFocus();
  });
});

describe("the connect dialog", () => {
  it("shows a 403 from saving instead of closing", async () => {
    mockFetch(() => forbidden());
    renderAs("admin", page);
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await userEvent.type(await screen.findByLabelText("API token"), "sk_test_123");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(FORBIDDEN));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
