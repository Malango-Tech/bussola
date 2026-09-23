"use client";

import { useReducer } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PROVIDER_CATALOG } from "@/lib/connectors/catalog";
import {
  CHANNEL_LABEL,
  COMPARATOR_LABEL,
  COOLDOWN_CHOICES,
  type AlertableConnection,
  type ChannelRow,
  type Comparator,
  type MetricOption,
  type NewRule,
} from "./types";

export type RuleFormState = {
  connectionId: string;
  metricKey: string;
  comparator: Comparator;
  /** As typed, so a half-entered "-" or "1e" does not get rewritten. */
  threshold: string;
  channelIds: string[];
  cooldown: number;
  saving: boolean;
};

export type RuleFormAction =
  /** `metric` is the new source's first metric, whose defaults come with it. */
  | { type: "connection"; id: string; metric?: MetricOption }
  | { type: "metric"; key: string; metric?: MetricOption }
  | { type: "comparator"; value: Comparator }
  | { type: "threshold"; value: string }
  | { type: "cooldown"; value: number }
  | { type: "toggleChannel"; id: string }
  | { type: "saving"; value: boolean };

/**
 * The rule form's state transitions.
 *
 * Picking a source or a metric replaces the comparator and threshold with the
 * metric's own defaults: a threshold typed for "failed deploys" means nothing
 * once the rule watches MRR. The component looks the metric up and passes it
 * in, so this stays a pure function of what was chosen.
 */
export function ruleFormReducer(
  state: RuleFormState,
  action: RuleFormAction,
): RuleFormState {
  switch (action.type) {
    case "connection":
      return action.metric
        ? { ...state, connectionId: action.id, ...defaultsOf(action.metric) }
        : { ...state, connectionId: action.id };
    case "metric":
      return action.metric
        ? { ...state, ...defaultsOf(action.metric), metricKey: action.key }
        : { ...state, metricKey: action.key };
    case "comparator":
      return { ...state, comparator: action.value };
    case "threshold":
      return { ...state, threshold: action.value };
    case "cooldown":
      return { ...state, cooldown: action.value };
    case "toggleChannel":
      return {
        ...state,
        channelIds: state.channelIds.includes(action.id)
          ? state.channelIds.filter((id) => id !== action.id)
          : [...state.channelIds, action.id],
      };
    case "saving":
      return { ...state, saving: action.value };
  }
}

function defaultsOf(metric: MetricOption) {
  return {
    metricKey: metric.key,
    comparator: metric.defaultComparator,
    threshold: String(metric.defaultThreshold),
  };
}

/** The first source, its first metric, and that metric's defaults. */
export function initialRuleForm(
  connections: AlertableConnection[],
  metrics: MetricOption[],
): RuleFormState {
  const connectionId = connections[0]?.id ?? "";
  const provider = connections[0]?.provider;
  const metric = metrics.find((m) => m.provider === provider);
  return {
    connectionId,
    metricKey: metric?.key ?? "",
    comparator: metric?.defaultComparator ?? "above",
    threshold: String(metric?.defaultThreshold ?? 0),
    channelIds: [],
    cooldown: 60,
    saving: false,
  };
}

export function RuleForm({
  id,
  connections,
  metrics,
  channels,
  onCancel,
  onCreate,
}: {
  /** For the toggle that opens it to point `aria-controls` at. */
  id?: string;
  connections: AlertableConnection[];
  metrics: MetricOption[];
  channels: ChannelRow[];
  onCancel: () => void;
  onCreate: (input: NewRule) => Promise<boolean>;
}) {
  const [form, dispatch] = useReducer(
    ruleFormReducer,
    undefined,
    () => initialRuleForm(connections, metrics),
  );
  const connection = connections.find((c) => c.id === form.connectionId);

  /** Only this source's metrics — a Stripe rule cannot watch Railway. */
  const available = metrics.filter(
    (metric) => metric.provider === connection?.provider,
  );
  const metric =
    available.find((m) => m.key === form.metricKey) ?? available[0];

  function chooseConnection(id: string) {
    const provider = connections.find((c) => c.id === id)?.provider;
    dispatch({
      type: "connection",
      id,
      metric: metrics.find((m) => m.provider === provider),
    });
  }

  function chooseMetric(key: string) {
    dispatch({
      type: "metric",
      key,
      metric: available.find((m) => m.key === key),
    });
  }

  const numeric = Number(form.threshold);
  const valid =
    Boolean(form.connectionId && form.metricKey) && Number.isFinite(numeric);

  return (
    <div
      id={id}
      role="group"
      aria-label="New rule"
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rule-connection">Source</Label>
          <Select
            id="rule-connection"
            value={form.connectionId}
            onChange={(event) => chooseConnection(event.target.value)}
          >
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.label} ({PROVIDER_CATALOG[connection.provider].name})
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-metric">Watch</Label>
          <Select
            id="rule-metric"
            aria-describedby={metric ? "rule-metric-description" : undefined}
            value={form.metricKey}
            onChange={(event) => chooseMetric(event.target.value)}
          >
            {available.map((metric) => (
              <option key={metric.key} value={metric.key}>
                {metric.label}
              </option>
            ))}
          </Select>
          {metric ? (
            <p
              id="rule-metric-description"
              className="text-xs text-muted-foreground"
            >
              {metric.description}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-comparator">When it</Label>
          <Select
            id="rule-comparator"
            value={form.comparator}
            onChange={(event) =>
              dispatch({
                type: "comparator",
                value: event.target.value as Comparator,
              })
            }
          >
            {(Object.keys(COMPARATOR_LABEL) as Comparator[]).map((key) => (
              <option key={key} value={key}>
                {COMPARATOR_LABEL[key]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-threshold">Threshold</Label>
          <Input
            id="rule-threshold"
            type="number"
            step="any"
            value={form.threshold}
            onChange={(event) =>
              dispatch({ type: "threshold", value: event.target.value })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-cooldown">Don’t repeat within</Label>
          <Select
            id="rule-cooldown"
            aria-describedby="rule-cooldown-hint"
            value={String(form.cooldown)}
            onChange={(event) =>
              dispatch({ type: "cooldown", value: Number(event.target.value) })
            }
          >
            {COOLDOWN_CHOICES.map((minutes) => (
              <option key={minutes} value={String(minutes)}>
                {minutes >= 60 ? `${minutes / 60} hours` : `${minutes} minutes`}
              </option>
            ))}
          </Select>
          <p id="rule-cooldown-hint" className="text-xs text-muted-foreground">
            Recoveries are always sent immediately.
          </p>
        </div>
      </div>

      {/* Toggle buttons rather than one control, so they are grouped and
          named by the label instead of being labelled by it. */}
      <div
        role="group"
        aria-labelledby="rule-notify-label"
        className="space-y-1.5"
      >
        <Label id="rule-notify-label">Notify</Label>
        {channels.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No channels yet — this rule will record here and nowhere else.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {channels.map((channel) => {
              const on = form.channelIds.includes(channel.id);
              return (
                <Button
                  key={channel.id}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  aria-pressed={on}
                  onClick={() =>
                    dispatch({ type: "toggleChannel", id: channel.id })
                  }
                >
                  {CHANNEL_LABEL[channel.kind]} · {channel.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!valid || form.saving}
          onClick={async () => {
            dispatch({ type: "saving", value: true });
            await onCreate({
              connectionId: form.connectionId,
              metric: form.metricKey,
              comparator: form.comparator,
              threshold: numeric,
              channelIds: form.channelIds,
              cooldownMinutes: form.cooldown,
            });
            dispatch({ type: "saving", value: false });
          }}
        >
          {form.saving ? "Creating…" : "Create rule"}
        </Button>
      </div>
    </div>
  );
}
