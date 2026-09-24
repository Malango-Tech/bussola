// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberRole } from "@/lib/auth/roles";
import { forbidden, mockFetch, renderAs, sentBody } from "@/test/render";
import { BillingSection } from "./billing-section";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BILLING = {
  enabled: true,
  planName: "Solo",
  active: true,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  limits: { dashboards: 3, seats: 1, historyDays: 30 },
  usage: { connections: 1, dashboards: 1, seats: 1 },
  plans: [
    {
      id: "team",
      name: "Team",
      monthlyCents: 4900,
      yearlyCents: 49000,
      currency: "eur",
      intervals: { monthly: true, yearly: true },
    },
  ],
};

const OWNER_ONLY = "Only an owner of this organization can do that.";

function api(onWrite: () => Response) {
  return mockFetch((url, init) =>
    (init?.method ?? "GET") === "GET" ? Response.json(BILLING) : onWrite(),
  );
}

async function renderBilling(role: MemberRole, onWrite = () => forbidden(OWNER_ONLY)) {
  const fetch = api(onWrite);
  renderAs(role, <BillingSection />);
  await screen.findByRole("button", { name: /Manage billing/ });
  return fetch;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("BillingSection", () => {
  it.each(["member", "admin"] as const)(
    "shows a %s the plan but keeps its buttons to the owner",
    async (role) => {
      await renderBilling(role);
      expect(screen.getByText("Solo")).toBeInTheDocument();
      const manage = screen.getByRole("button", { name: "Manage billing" });
      const upgrade = screen.getByRole("button", { name: /Team/ });
      for (const button of [manage, upgrade]) {
        expect(button).toBeDisabled();
        expect(button).toHaveAccessibleDescription(
          "Only an owner can change the plan or billing details.",
        );
      }
    },
  );

  it("lets an owner start a checkout for the chosen interval", async () => {
    const fetch = await renderBilling("owner", () =>
      Response.json({ error: "Stripe is down" }, { status: 502 }),
    );
    expect(screen.queryByText(/Only an owner can/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "yearly" }));
    expect(screen.getByRole("button", { name: "yearly" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /Team/ }));

    const post = fetch.mock.calls.findIndex(([, init]) => init?.method === "POST");
    expect(fetch.mock.calls[post]?.[0]).toBe("/api/billing/checkout");
    expect(sentBody(fetch, post)).toEqual({ plan: "team", interval: "yearly" });
    // The server's message, not a generic one.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Stripe is down"));
  });

  it("surfaces a 403 if the owner check fails on the server", async () => {
    await renderBilling("owner");
    await userEvent.click(screen.getByRole("button", { name: "Manage billing" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OWNER_ONLY));
  });
});
