// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelRow, EventRow, MetricOption, RuleRow } from "@/components/alerts/types";
import type { MemberRole } from "@/lib/auth/roles";
import { FORBIDDEN, forbidden, mockFetch, renderAs, sentBody } from "@/test/render";
import { AlertsManager } from "./alerts-manager";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const METRICS: MetricOption[] = [
  {
    key: "vercel.failedProjects",
    provider: "vercel",
    label: "Failed projects",
    description: "Projects whose latest deploy failed",
    unit: "count",
    defaultComparator: "above",
    defaultThreshold: 0,
  },
];

const CHANNEL: ChannelRow = {
  id: "chn_1",
  kind: "slack",
  label: "Ops",
  enabled: true,
  lastError: null,
  lastDeliveredAt: null,
};

const RULE: RuleRow = {
  id: "rul_1",
  connectionId: "con_1",
  connectionLabel: "Prod",
  provider: "vercel",
  metric: "vercel.failedProjects",
  comparator: "above",
  threshold: "0",
  channelIds: ["chn_1"],
  enabled: true,
  cooldownMinutes: 60,
  lastState: null,
  lastValue: null,
  lastEvaluatedAt: null,
  mutedUntil: null,
};

const EVENT: EventRow = {
  id: "evt_1",
  state: "breached",
  message: "Failed projects went above 0",
  connectionLabel: "Prod",
  provider: "vercel",
  acknowledgedAt: null,
  createdAt: new Date().toISOString(),
};

function renderAlerts(role: MemberRole) {
  return renderAs(
    role,
    <AlertsManager
      initialRules={[RULE]}
      initialChannels={[CHANNEL]}
      initialEvents={[EVENT]}
      connections={[{ id: "con_1", provider: "vercel", label: "Prod" }]}
      metrics={METRICS}
      allowedChannels={["email", "slack", "discord"]}
      planName="Self-hosted"
      emailReady
      emailSetupHint="Set RESEND_API_KEY"
    />,
  );
}

const channels = () =>
  screen.getByRole("heading", { name: "Channels" }).closest("section") as HTMLElement;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AlertsManager, as a member", () => {
  it("shows where alerts go but not how to change it", () => {
    renderAlerts("member");
    const section = within(channels());
    expect(section.getByText("Ops")).toBeInTheDocument();
    expect(section.queryByRole("button", { name: "Add channel" })).not.toBeInTheDocument();
    expect(section.queryByRole("button", { name: /Send test/ })).not.toBeInTheDocument();
    expect(section.queryByRole("button", { name: /Remove channel/ })).not.toBeInTheDocument();
    expect(section.getByText(/Only an owner or admin can add, test or remove a channel/)).toBeInTheDocument();
  });

  it("still lets a member manage rules", () => {
    renderAlerts("member");
    expect(screen.getByRole("button", { name: "New rule" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Rule enabled: Failed projects on Prod" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete rule: Failed projects on Prod" })).toBeInTheDocument();
  });
});

describe("AlertsManager, as an admin", () => {
  it("adds a channel", async () => {
    const fetch = mockFetch(() =>
      Response.json(
        { channel: { ...CHANNEL, id: "chn_2", kind: "email", label: "Pager" } },
        { status: 201 },
      ),
    );
    renderAlerts("admin");

    const toggle = screen.getByRole("button", { name: "Add channel" });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const form = within(screen.getByRole("group", { name: "New channel" }));
    await userEvent.selectOptions(form.getByLabelText("Type"), "email");
    await userEvent.type(form.getByLabelText("Name"), "Pager");
    await userEvent.type(form.getByLabelText("Address"), "pager@acme.test");
    await userEvent.click(form.getByRole("button", { name: "Add channel" }));

    expect(sentBody(fetch, 0)).toEqual({ kind: "email", label: "Pager", target: "pager@acme.test" });
    await waitFor(() => expect(screen.queryByRole("group", { name: "New channel" })).not.toBeInTheDocument());
    expect(within(channels()).getByText("Pager")).toBeInTheDocument();
  });

  it("sends a test and records a refusal on the channel", async () => {
    mockFetch(() => Response.json({ ok: false, error: "Slack answered 404" }));
    renderAlerts("admin");
    await userEvent.click(screen.getByRole("button", { name: "Send test to Ops" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Slack answered 404"));
    expect(within(channels()).getByText("Slack answered 404")).toBeInTheDocument();
  });

  it("shows a 403 from the server rather than a generic failure", async () => {
    mockFetch(() => forbidden());
    renderAlerts("admin");
    await userEvent.click(screen.getByRole("button", { name: "Remove channel Ops" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(FORBIDDEN));
    expect(within(channels()).getByText("Ops")).toBeInTheDocument();
  });

  it("drops a removed channel from every rule that used it", async () => {
    mockFetch(() => Response.json({ ok: true }));
    renderAlerts("admin");
    expect(screen.getByText("1 channel")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove channel Ops" }));
    expect(await screen.findByText("In-app only")).toBeInTheDocument();
  });
});

describe("AlertsManager, for everyone", () => {
  it("acknowledges outstanding alerts", async () => {
    const fetch = mockFetch(() => Response.json({ ok: true, acknowledged: 1 }));
    renderAlerts("member");
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge 1" }));
    expect(fetch).toHaveBeenCalledWith("/api/alerts/events", expect.objectContaining({ method: "POST" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Acknowledge/ })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("mutes a rule for a day", async () => {
    const fetch = mockFetch(() =>
      Response.json({ rule: { ...RULE, mutedUntil: new Date(Date.now() + 86_400_000).toISOString() } }),
    );
    renderAlerts("member");
    await userEvent.click(screen.getByRole("button", { name: "Mute rule for 24 hours: Failed projects on Prod" }));
    expect(sentBody(fetch, 0)).toEqual({ id: "rul_1", muteHours: 24 });
    expect(await screen.findByRole("button", { name: "Unmute rule: Failed projects on Prod" })).toBeInTheDocument();
  });
});
