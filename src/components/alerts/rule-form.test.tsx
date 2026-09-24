// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initialRuleForm, RuleForm, ruleFormReducer } from "./rule-form";
import type { AlertableConnection, ChannelRow, MetricOption, NewRule } from "./types";

const metric = (
  key: string,
  provider: MetricOption["provider"],
  defaultComparator: "above" | "below",
  defaultThreshold: number,
): MetricOption => ({
  key,
  provider,
  label: key,
  description: `About ${key}`,
  unit: "count",
  defaultComparator,
  defaultThreshold,
});

const METRICS = [
  metric("railway.crashedServices", "railway", "above", 0),
  metric("railway.creditBalance", "railway", "below", 5),
  metric("stripe.mrr", "stripe", "below", 1000),
];

const CONNECTIONS: AlertableConnection[] = [
  { id: "con_railway", provider: "railway", label: "Infra" },
  { id: "con_stripe", provider: "stripe", label: "Billing" },
];

const CHANNELS: ChannelRow[] = [
  { id: "chn_mail", kind: "email", label: "On-call", enabled: true, lastError: null, lastDeliveredAt: null },
  { id: "chn_slack", kind: "slack", label: "Ops", enabled: true, lastError: null, lastDeliveredAt: null },
];

function renderForm(
  onCreate = vi.fn<(input: NewRule) => Promise<boolean>>(async () => true),
  onCancel = vi.fn(),
) {
  render(
    <RuleForm
      connections={CONNECTIONS}
      metrics={METRICS}
      channels={CHANNELS}
      onCancel={onCancel}
      onCreate={onCreate}
    />,
  );
  return { onCreate, onCancel };
}

describe("RuleForm", () => {
  it("starts on the first source, its first metric and that metric's defaults", () => {
    renderForm();
    expect(screen.getByLabelText("Source")).toHaveValue("con_railway");
    expect(screen.getByLabelText("Watch")).toHaveValue("railway.crashedServices");
    expect(screen.getByLabelText("Watch")).toHaveAccessibleDescription("About railway.crashedServices");
    expect(screen.getByLabelText("When it")).toHaveValue("above");
    expect(screen.getByLabelText("Threshold")).toHaveValue(0);
    expect(screen.getByLabelText("Don’t repeat within")).toHaveValue("60");
  });

  it("offers only the chosen source's metrics", async () => {
    renderForm();
    const options = () =>
      Array.from((screen.getByLabelText("Watch") as HTMLSelectElement).options).map((o) => o.value);
    expect(options()).toEqual(["railway.crashedServices", "railway.creditBalance"]);
    await userEvent.selectOptions(screen.getByLabelText("Source"), "con_stripe");
    expect(options()).toEqual(["stripe.mrr"]);
  });

  it("replaces a typed threshold with the new metric's defaults", async () => {
    renderForm();
    await userEvent.clear(screen.getByLabelText("Threshold"));
    await userEvent.type(screen.getByLabelText("Threshold"), "12");
    await userEvent.selectOptions(screen.getByLabelText("Watch"), "railway.creditBalance");
    expect(screen.getByLabelText("When it")).toHaveValue("below");
    expect(screen.getByLabelText("Threshold")).toHaveValue(5);

    await userEvent.selectOptions(screen.getByLabelText("Source"), "con_stripe");
    expect(screen.getByLabelText("Watch")).toHaveValue("stripe.mrr");
    expect(screen.getByLabelText("Threshold")).toHaveValue(1000);
  });

  it("toggles channels as pressed buttons in a named group", async () => {
    renderForm();
    const group = screen.getByRole("group", { name: "Notify" });
    const ops = screen.getByRole("button", { name: "Slack · Ops" });
    expect(group).toContainElement(ops);
    expect(ops).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(ops);
    expect(ops).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(ops);
    expect(ops).toHaveAttribute("aria-pressed", "false");
  });

  it("creates exactly the rule on screen", async () => {
    const { onCreate } = renderForm();
    await userEvent.selectOptions(screen.getByLabelText("Source"), "con_stripe");
    await userEvent.selectOptions(screen.getByLabelText("When it"), "not_equals");
    await userEvent.clear(screen.getByLabelText("Threshold"));
    await userEvent.type(screen.getByLabelText("Threshold"), "-2.5");
    await userEvent.selectOptions(screen.getByLabelText("Don’t repeat within"), "180");
    await userEvent.click(screen.getByRole("button", { name: "Email · On-call" }));
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(onCreate).toHaveBeenCalledWith({
      connectionId: "con_stripe",
      metric: "stripe.mrr",
      comparator: "not_equals",
      threshold: -2.5,
      channelIds: ["chn_mail"],
      cooldownMinutes: 180,
    });
  });

  it("holds the button while the rule is being created", async () => {
    let finish: (created: boolean) => void = () => {};
    const onCreate = vi.fn(
      () => new Promise<boolean>((resolve) => { finish = resolve; }),
    );
    renderForm(onCreate);
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    finish(false);
    expect(await screen.findByRole("button", { name: "Create rule" })).toBeEnabled();
  });

  it("cancels", async () => {
    const { onCancel, onCreate } = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("ruleFormReducer", () => {
  const start = initialRuleForm(CONNECTIONS, METRICS);

  it("keeps the current metric when a source brings none", () => {
    const next = ruleFormReducer(start, { type: "connection", id: "con_other" });
    expect(next).toMatchObject({ connectionId: "con_other", metricKey: "railway.crashedServices" });
  });

  it("leaves the threshold as typed, so a half-entered number survives", () => {
    expect(ruleFormReducer(start, { type: "threshold", value: "-" }).threshold).toBe("-");
  });

  it("starts empty when there is nothing to watch", () => {
    expect(initialRuleForm([], METRICS)).toMatchObject({
      connectionId: "",
      metricKey: "",
      comparator: "above",
      threshold: "0",
    });
  });
});
