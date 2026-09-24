// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChannelForm } from "./channel-form";
import type { ChannelKind } from "./types";

function renderForm({
  allowed = ["email", "slack"] as ChannelKind[],
  emailReady = true,
} = {}) {
  const onCreate = vi.fn(async () => true);
  render(
    <ChannelForm
      allowedChannels={allowed}
      emailReady={emailReady}
      emailSetupHint="Set RESEND_API_KEY to send email."
      onCancel={vi.fn()}
      onCreate={onCreate}
    />,
  );
  return onCreate;
}

describe("ChannelForm", () => {
  it("offers only the kinds the plan allows", () => {
    renderForm({ allowed: ["email"] });
    const kinds = Array.from((screen.getByLabelText("Type") as HTMLSelectElement).options);
    expect(kinds.map((option) => option.value)).toEqual(["email"]);
  });

  it("asks for a webhook URL once a chat kind is picked", async () => {
    renderForm();
    expect(screen.getByLabelText("Address")).toHaveAttribute("placeholder", "alerts@yourcompany.com");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "slack");
    expect(screen.getByLabelText("Webhook URL")).toHaveAttribute(
      "placeholder",
      "https://hooks.slack.com/services/…",
    );
  });

  it("warns, without blocking, when this install cannot send email", async () => {
    const onCreate = renderForm({ emailReady: false });
    const address = screen.getByLabelText("Address");
    expect(address).toHaveAccessibleDescription("Set RESEND_API_KEY to send email.");

    await userEvent.type(screen.getByLabelText("Name"), "Pager");
    await userEvent.type(address, "pager@acme.test");
    await userEvent.click(screen.getByRole("button", { name: "Add channel" }));
    expect(onCreate).toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText("Type"), "slack");
    expect(screen.queryByText("Set RESEND_API_KEY to send email.")).not.toBeInTheDocument();
  });

  it("needs a name and a destination, and trims both", async () => {
    const onCreate = renderForm();
    const add = screen.getByRole("button", { name: "Add channel" });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "  On-call  ");
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Address"), " oncall@acme.test ");
    await userEvent.click(add);
    expect(onCreate).toHaveBeenCalledWith({
      kind: "email",
      label: "On-call",
      target: "oncall@acme.test",
    });
  });
});
