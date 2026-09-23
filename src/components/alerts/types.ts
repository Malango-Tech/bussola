import type { Provider } from "@/lib/providers";

/**
 * The shapes the alerts screen works in, and the words it uses for them.
 *
 * Kept apart from any component so the list, the forms and the state hook all
 * agree on one vocabulary without importing each other.
 */

export type ChannelKind = "email" | "slack" | "discord";
export type Comparator = "above" | "below" | "equals" | "not_equals";

export type MetricOption = {
  key: string;
  provider: Provider;
  label: string;
  description: string;
  unit: string;
  defaultComparator: "above" | "below";
  defaultThreshold: number;
};

export type RuleRow = {
  id: string;
  connectionId: string;
  connectionLabel: string;
  provider: Provider;
  metric: string;
  comparator: Comparator;
  threshold: string;
  channelIds: string[];
  enabled: boolean;
  cooldownMinutes: number;
  lastState: string | null;
  lastValue: string | null;
  lastEvaluatedAt: string | null;
  mutedUntil: string | null;
};

export type ChannelRow = {
  id: string;
  kind: ChannelKind;
  label: string;
  enabled: boolean;
  lastError: string | null;
  lastDeliveredAt: string | null;
};

export type EventRow = {
  id: string;
  state: string;
  message: string;
  connectionLabel: string;
  provider: Provider;
  acknowledgedAt: string | null;
  createdAt: string;
};

/** A source a rule can watch, as the rule form lists it. */
export type AlertableConnection = { id: string; provider: Provider; label: string };

/** What the rule form hands back; the API's create payload, exactly. */
export type NewRule = {
  connectionId: string;
  metric: string;
  comparator: Comparator;
  threshold: number;
  channelIds: string[];
  cooldownMinutes: number;
};

/** What the channel form hands back; the API's create payload, exactly. */
export type NewChannel = {
  kind: ChannelKind;
  label: string;
  target: string;
};

export const COMPARATOR_LABEL: Record<Comparator, string> = {
  above: "goes above",
  below: "drops below",
  equals: "equals",
  not_equals: "is not",
};

export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  email: "Email",
  slack: "Slack",
  discord: "Discord",
};

export const CHANNEL_PLACEHOLDER: Record<ChannelKind, string> = {
  email: "alerts@yourcompany.com",
  slack: "https://hooks.slack.com/services/…",
  discord: "https://discord.com/api/webhooks/…",
};

export const COOLDOWN_CHOICES = [15, 30, 60, 180, 360, 720, 1440] as const;
