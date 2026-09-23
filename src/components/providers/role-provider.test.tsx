// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Permission } from "@/lib/auth/roles";
import { RoleProvider, useCan } from "./role-provider";

function Gate({ permission }: { permission: Permission }) {
  return useCan(permission) ? <button>allowed</button> : <p>hidden</p>;
}

describe("useCan", () => {
  it("hides admin controls from a member", () => {
    render(
      <RoleProvider role="member">
        <Gate permission="manageConnections" />
      </RoleProvider>,
    );
    expect(screen.getByText("hidden")).toBeInTheDocument();
  });

  it("shows them to an admin, but not billing", () => {
    render(
      <RoleProvider role="admin">
        <Gate permission="manageConnections" />
        <Gate permission="manageBilling" />
      </RoleProvider>,
    );
    expect(screen.getByRole("button", { name: "allowed" })).toBeInTheDocument();
    expect(screen.getByText("hidden")).toBeInTheDocument();
  });

  it("leaves the decision to the server outside a provider", () => {
    render(<Gate permission="manageBilling" />);
    expect(screen.getByRole("button", { name: "allowed" })).toBeInTheDocument();
  });
});
