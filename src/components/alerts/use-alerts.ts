"use client";

import { useReducer, useState } from "react";
import { toast } from "sonner";
import { readJson } from "@/components/api-client";
import type {
  ChannelRow,
  EventRow,
  NewChannel,
  NewRule,
  RuleRow,
} from "./types";

export type AlertsState = {
  rules: RuleRow[];
  channels: ChannelRow[];
  events: EventRow[];
};

export type AlertsAction =
  | { type: "ruleCreated"; rule: RuleRow }
  | { type: "ruleUpdated"; rule: RuleRow }
  | { type: "ruleDeleted"; id: string }
  | { type: "channelCreated"; channel: ChannelRow }
  | { type: "channelDeleted"; id: string }
  | { type: "channelTested"; id: string; ok: boolean; error?: string; at: string }
  | { type: "eventsAcknowledged"; at: string };

/**
 * Every change the server confirmed, applied to what is on screen.
 *
 * One reducer rather than three setters because some changes cross lists: a
 * removed channel also has to disappear from every rule that pointed at it,
 * and doing that in one place is what keeps the two from disagreeing.
 */
export function alertsReducer(
  state: AlertsState,
  action: AlertsAction,
): AlertsState {
  switch (action.type) {
    case "ruleCreated":
      return { ...state, rules: [action.rule, ...state.rules] };
    case "ruleUpdated":
      return {
        ...state,
        rules: state.rules.map((rule) =>
          rule.id === action.rule.id ? action.rule : rule,
        ),
      };
    case "ruleDeleted":
      return {
        ...state,
        rules: state.rules.filter((rule) => rule.id !== action.id),
      };
    case "channelCreated":
      return { ...state, channels: [...state.channels, action.channel] };
    case "channelDeleted":
      return {
        ...state,
        channels: state.channels.filter((channel) => channel.id !== action.id),
        // A rule that pointed at it is now down one destination; reflect that
        // without a refetch so the rule list does not claim a channel that is
        // gone.
        rules: state.rules.map((rule) => ({
          ...rule,
          channelIds: rule.channelIds.filter((id) => id !== action.id),
        })),
      };
    case "channelTested":
      return {
        ...state,
        channels: state.channels.map((row) =>
          row.id === action.id
            ? {
                ...row,
                lastError: action.ok ? null : (action.error ?? "Delivery failed"),
                lastDeliveredAt: action.ok ? action.at : row.lastDeliveredAt,
              }
            : row,
        ),
      };
    case "eventsAcknowledged":
      return {
        ...state,
        events: state.events.map((event) =>
          event.acknowledgedAt ? event : { ...event, acknowledgedAt: action.at },
        ),
      };
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * The alerts screen's data and every request that changes it.
 *
 * Each action reports failure as a toast carrying the server's own message —
 * a 402 names the plan, a 403 names the role that is missing — and only
 * touches local state once the server has agreed.
 */
export function useAlerts(initial: AlertsState) {
  const [state, dispatch] = useReducer(alertsReducer, initial);
  const [testing, setTesting] = useState<string | null>(null);

  async function createRule(input: NewRule): Promise<boolean> {
    const res = await fetch("/api/alerts/rules", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
    const json = await readJson<{ rule: RuleRow }>(res);
    if (!res.ok || !json.rule) {
      toast.error(json.error || "Could not create the rule");
      return false;
    }
    dispatch({ type: "ruleCreated", rule: json.rule });
    toast.success("Rule created");
    return true;
  }

  async function patchRule(id: string, patch: Record<string, unknown>) {
    const res = await fetch("/api/alerts/rules", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ id, ...patch }),
    });
    const json = await readJson<{ rule: RuleRow }>(res);
    if (!res.ok || !json.rule) {
      toast.error(json.error || "Could not update the rule");
      return;
    }
    dispatch({ type: "ruleUpdated", rule: json.rule });
  }

  async function deleteRule(id: string) {
    const res = await fetch(`/api/alerts/rules?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error((await readJson(res)).error || "Could not delete the rule");
      return;
    }
    dispatch({ type: "ruleDeleted", id });
    toast.success("Rule deleted");
  }

  async function createChannel(input: NewChannel): Promise<boolean> {
    const res = await fetch("/api/alerts/channels", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
    const json = await readJson<{ channel: ChannelRow }>(res);
    if (!res.ok || !json.channel) {
      toast.error(json.error || "Could not add the channel");
      return false;
    }
    dispatch({ type: "channelCreated", channel: json.channel });
    toast.success("Channel added");
    return true;
  }

  async function deleteChannel(id: string) {
    const res = await fetch(`/api/alerts/channels?id=${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error((await readJson(res)).error || "Could not remove the channel");
      return;
    }
    dispatch({ type: "channelDeleted", id });
    toast.success("Channel removed");
  }

  /**
   * Prove a channel end to end.
   *
   * A channel is otherwise only tested the first time something breaks, which
   * is the worst possible moment to discover a typo in a webhook URL or an
   * unset mail provider.
   */
  async function sendTest(channel: ChannelRow) {
    setTesting(channel.id);
    try {
      const res = await fetch("/api/alerts/channels/test", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: channel.id }),
      });
      const json = await readJson<{ ok: boolean }>(res);

      if (!res.ok) {
        toast.error(json.error || "Could not send a test");
        return;
      }
      if (json.ok) {
        toast.success(`Test sent to ${channel.label}`);
      } else {
        toast.error(json.error || "The channel did not accept the message");
      }

      dispatch({
        type: "channelTested",
        id: channel.id,
        ok: Boolean(json.ok),
        error: json.error,
        at: new Date().toISOString(),
      });
    } finally {
      setTesting(null);
    }
  }

  async function acknowledgeAll() {
    const res = await fetch("/api/alerts/events", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      toast.error((await readJson(res)).error || "Could not acknowledge");
      return;
    }
    dispatch({ type: "eventsAcknowledged", at: new Date().toISOString() });
  }

  return {
    ...state,
    testing,
    createRule,
    patchRule,
    deleteRule,
    createChannel,
    deleteChannel,
    sendTest,
    acknowledgeAll,
  };
}
