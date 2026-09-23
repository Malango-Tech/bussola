"use client";

import { useReducer } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  CHANNEL_LABEL,
  CHANNEL_PLACEHOLDER,
  type ChannelKind,
  type NewChannel,
} from "./types";

type ChannelFormState = {
  kind: ChannelKind;
  label: string;
  target: string;
  saving: boolean;
};

type ChannelFormAction =
  | { type: "kind"; value: ChannelKind }
  | { type: "label"; value: string }
  | { type: "target"; value: string }
  | { type: "saving"; value: boolean };

function channelFormReducer(
  state: ChannelFormState,
  action: ChannelFormAction,
): ChannelFormState {
  switch (action.type) {
    case "kind":
      return { ...state, kind: action.value };
    case "label":
      return { ...state, label: action.value };
    case "target":
      return { ...state, target: action.value };
    case "saving":
      return { ...state, saving: action.value };
  }
}

export function ChannelForm({
  id,
  allowedChannels,
  emailReady,
  emailSetupHint,
  onCancel,
  onCreate,
}: {
  /** For the toggle that opens it to point `aria-controls` at. */
  id?: string;
  allowedChannels: ChannelKind[];
  emailReady: boolean;
  emailSetupHint: string;
  onCancel: () => void;
  onCreate: (input: NewChannel) => Promise<boolean>;
}) {
  const [form, dispatch] = useReducer(channelFormReducer, {
    kind: allowedChannels[0] ?? "email",
    label: "",
    target: "",
    saving: false,
  });
  const { kind, label, target, saving } = form;

  // Email needs server configuration no plan can supply, so this warns rather
  // than blocks: someone may well be setting the variables next.
  const emailUnconfigured = kind === "email" && !emailReady;

  return (
    <div
      id={id}
      role="group"
      aria-label="New channel"
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="channel-kind">Type</Label>
          <Select
            id="channel-kind"
            value={kind}
            onChange={(event) =>
              dispatch({ type: "kind", value: event.target.value as ChannelKind })
            }
          >
            {allowedChannels.map((option) => (
              <option key={option} value={option}>
                {CHANNEL_LABEL[option]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="channel-label">Name</Label>
          <Input
            id="channel-label"
            value={label}
            placeholder="e.g. On-call"
            onChange={(event) =>
              dispatch({ type: "label", value: event.target.value })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="channel-target">
            {kind === "email" ? "Address" : "Webhook URL"}
          </Label>
          <Input
            id="channel-target"
            type={kind === "email" ? "email" : "url"}
            aria-describedby={emailUnconfigured ? "channel-email-hint" : undefined}
            value={target}
            placeholder={CHANNEL_PLACEHOLDER[kind]}
            onChange={(event) =>
              dispatch({ type: "target", value: event.target.value })
            }
          />
        </div>
      </div>

      {emailUnconfigured ? (
        <p
          id="channel-email-hint"
          className="flex items-start gap-2 text-xs text-warning"
        >
          <WarningIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {emailSetupHint}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!label.trim() || !target.trim() || saving}
          onClick={async () => {
            dispatch({ type: "saving", value: true });
            await onCreate({ kind, label: label.trim(), target: target.trim() });
            dispatch({ type: "saving", value: false });
          }}
        >
          {saving ? "Adding…" : "Add channel"}
        </Button>
      </div>
    </div>
  );
}
