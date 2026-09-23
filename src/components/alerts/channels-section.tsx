"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { PaperPlaneTiltIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { SectionHeading } from "@/components/layout/page";
import { PermissionHint } from "@/components/layout/permission-hint";
import { useCan } from "@/components/providers/role-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChannelForm } from "./channel-form";
import {
  CHANNEL_LABEL,
  type ChannelKind,
  type ChannelRow,
  type NewChannel,
} from "./types";

type Props = {
  channels: ChannelRow[];
  /** Kinds this plan allows; empty when alerts are not on the plan at all. */
  allowedChannels: ChannelKind[];
  emailReady: boolean;
  emailSetupHint: string;
  /** The channel whose test send is in flight, if any. */
  testing: string | null;
  onCreate: (input: NewChannel) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onTest: (channel: ChannelRow) => Promise<void>;
};

/** Where alerts go. */
export function ChannelsSection({
  channels,
  allowedChannels,
  emailReady,
  emailSetupHint,
  testing,
  onCreate,
  onDelete,
  onTest,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const alertsAvailable = allowedChannels.length > 0;
  // A channel is a destination outside the organization, and its webhook URL
  // is a credential: members see where alerts go, admins decide it.
  const canManage = useCan("manageChannels");

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Channels"
        description="Where alerts go. Without one, a rule still records here but reaches nobody."
        actions={
          alertsAvailable && canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowForm((open) => !open)}
            >
              <PlusIcon className="size-4" />
              Add channel
            </Button>
          ) : null
        }
      />

      {alertsAvailable && !canManage ? (
        <PermissionHint permission="manageChannels">
          add, test or remove a channel
        </PermissionHint>
      ) : null}

      {showForm && canManage ? (
        <ChannelForm
          allowedChannels={allowedChannels}
          emailReady={emailReady}
          emailSetupHint={emailSetupHint}
          onCancel={() => setShowForm(false)}
          onCreate={async (input) => {
            const created = await onCreate(input);
            if (created) setShowForm(false);
            return created;
          }}
        />
      ) : null}

      {channels.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No channels yet. Alerts will still show on this page.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {channels.map((channel) => (
            <ChannelItem
              key={channel.id}
              channel={channel}
              testing={testing === channel.id}
              canManage={canManage}
              onDelete={onDelete}
              onTest={onTest}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChannelItem({
  channel,
  testing,
  canManage,
  onDelete,
  onTest,
}: {
  channel: ChannelRow;
  testing: boolean;
  canManage: boolean;
  onDelete: Props["onDelete"];
  onTest: Props["onTest"];
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 text-sm">
      <Badge variant="outline">{CHANNEL_LABEL[channel.kind]}</Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{channel.label}</p>
        {channel.lastError ? (
          <p className="truncate text-xs text-destructive">{channel.lastError}</p>
        ) : channel.lastDeliveredAt ? (
          <p className="text-xs text-muted-foreground">
            Last delivered{" "}
            {formatDistanceToNow(new Date(channel.lastDeliveredAt), {
              addSuffix: true,
            })}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing sent yet</p>
        )}
      </div>
      {canManage ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testing}
            onClick={() => onTest(channel)}
          >
            <PaperPlaneTiltIcon className="size-3.5" />
            {testing ? "Sending…" : "Send test"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove channel"
            onClick={() => onDelete(channel.id)}
          >
            <TrashIcon className="size-4" />
          </Button>
        </>
      ) : null}
    </li>
  );
}
