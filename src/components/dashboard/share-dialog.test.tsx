// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRole } from "@/lib/auth/roles";
import { RoleProvider } from "@/components/providers/role-provider";
import { ShareDialog } from "./share-dialog";

/**
 * Who sees the controls for share links.
 *
 * The server refuses create and revoke below admin whatever the page shows;
 * these check that a member is not offered a form that was always going to
 * fail, and is told why instead.
 */

const SHARES = {
  shares: [
    {
      id: "s1",
      tokenPrefix: "bsh_ab12",
      label: "Investor update",
      whiteLabel: false,
      expiresAt: null,
      revokedAt: null,
      viewCount: 3,
      lastViewedAt: null,
      createdAt: "2026-09-01T10:00:00.000Z",
    },
  ],
  canWhiteLabel: false,
  planName: "Team",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(SHARES), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAs(role: MemberRole, canShare = true) {
  return render(
    <RoleProvider role={role}>
      <ShareDialog
        dashboardId="d1"
        dashboardName="Ops"
        canShare={canShare}
        onClose={() => {}}
      />
    </RoleProvider>,
  );
}

describe("ShareDialog", () => {
  it("is a dialog named by its title", async () => {
    renderAs("admin");
    expect(
      await screen.findByRole("dialog", { name: "Share “Ops”" }),
    ).toBeInTheDocument();
  });

  it("lets an admin create and revoke links", async () => {
    renderAs("admin");
    expect(
      await screen.findByRole("button", { name: "Revoke link Investor update" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create link" })).toBeInTheDocument();
    expect(screen.queryByText(/Only admins can create or revoke links/)).toBeNull();
  });

  it("shows a member the live links, but no controls, and says why", async () => {
    renderAs("member");
    expect(await screen.findByText("Investor update")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revoke link/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create link" })).toBeNull();
    expect(screen.queryByLabelText("Label (optional)")).toBeNull();
    expect(
      screen.getByText(/Only admins can create or revoke links/),
    ).toBeInTheDocument();
  });

  it("explains the plan rather than the role when links are not on the plan", async () => {
    renderAs("member", false);
    expect(await screen.findByText(/not part of the Team plan/)).toBeInTheDocument();
    expect(screen.queryByText(/Only admins can create or revoke links/)).toBeNull();
  });
});
