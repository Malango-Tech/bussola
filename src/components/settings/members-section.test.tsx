// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberRole } from "@/lib/auth/roles";
import { forbidden, mockFetch, renderAs } from "@/test/render";
import { MembersSection } from "./members-section";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Inviting and revoking invitations go through Better Auth's client, which
// has no server to talk to here; only the roster route is under test.
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    organization: {
      inviteMember: vi.fn(async () => ({ data: { id: "inv_new" }, error: null })),
      cancelInvitation: vi.fn(async () => ({ error: null })),
    },
  },
}));

const person = (role: string, email: string, isYou = false) => ({
  id: `mem_${role}`,
  userId: `usr_${role}`,
  name: "",
  email,
  role,
  joinedAt: "2026-01-01T00:00:00.000Z",
  isYou,
});

function roster(yourRole: MemberRole) {
  return {
    members: [
      person("owner", "owner@acme.test", yourRole === "owner"),
      person("admin", "admin@acme.test", yourRole === "admin"),
      person("member", "member@acme.test", yourRole === "member"),
    ],
    invitations: [
      {
        id: "inv_1",
        email: "new@acme.test",
        role: "member",
        expiresAt: "2026-12-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    seats: { used: 4, included: null },
    planName: "Self-hosted",
    yourRole,
    emailConfigured: true,
    emailSetupHint: "",
  };
}

async function renderMembers(role: MemberRole, onDelete = () => Response.json({ ok: true })) {
  const fetch = mockFetch((url, init) =>
    init?.method === "DELETE" ? onDelete() : Response.json(roster(role)),
  );
  renderAs(role, <MembersSection />);
  await screen.findByText("owner@acme.test");
  return fetch;
}

const removeButtons = () => screen.queryAllByRole("button", { name: /^Remove / });

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("MembersSection", () => {
  it("gives a member the roster and nothing to change it with", async () => {
    await renderMembers("member");
    expect(removeButtons()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Revoke invitation/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.getByText(/Only an owner or admin can invite or remove people/)).toBeInTheDocument();
    // Copying an invitation link is harmless, so it stays.
    expect(screen.getByRole("button", { name: "Copy invitation link for new@acme.test" })).toBeInTheDocument();
  });

  it("lets an admin manage members, but not remove an owner", async () => {
    await renderMembers("admin");
    expect(removeButtons().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Remove member@acme.test",
    ]);
    expect(screen.getByRole("button", { name: "Revoke invitation for new@acme.test" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("lets an owner remove anyone but themselves", async () => {
    await renderMembers("owner");
    expect(removeButtons().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Remove admin@acme.test",
      "Remove member@acme.test",
    ]);
  });

  it("shows the server's reason when a removal is refused", async () => {
    await renderMembers("admin", () => forbidden("Only an owner can remove another owner."));
    await userEvent.click(screen.getByRole("button", { name: "Remove member@acme.test" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Only an owner can remove another owner."),
    );
  });
});
