"use client";

import { useState } from "react";
import { BellSlashIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { EmptyState, SectionHeading } from "@/components/layout/page";
import { SourceIcon } from "@/components/brand/source-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { RuleForm } from "./rule-form";
import {
  COMPARATOR_LABEL,
  type AlertableConnection,
  type ChannelRow,
  type MetricOption,
  type NewRule,
  type RuleRow,
} from "./types";

const RULE_FORM_ID = "new-rule-form";

type Props = {
  rules: RuleRow[];
  /** Connections with at least one metric; the only ones a rule can watch. */
  alertable: AlertableConnection[];
  metrics: MetricOption[];
  channels: ChannelRow[];
  onCreate: (input: NewRule) => Promise<boolean>;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

/** What to watch, and when it counts as a problem. */
export function RulesSection({
  rules,
  alertable,
  metrics,
  channels,
  onCreate,
  onPatch,
  onDelete,
}: Props) {
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Rules"
        description="What to watch, and when it counts as a problem."
        actions={
          alertable.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={showForm}
              aria-controls={showForm ? RULE_FORM_ID : undefined}
              onClick={() => setShowForm((open) => !open)}
            >
              <PlusIcon className="size-4" aria-hidden />
              New rule
            </Button>
          ) : null
        }
      />

      {showForm ? (
        <RuleForm
          id={RULE_FORM_ID}
          connections={alertable}
          metrics={metrics}
          channels={channels}
          onCancel={() => setShowForm(false)}
          onCreate={async (input) => {
            const created = await onCreate(input);
            if (created) setShowForm(false);
            return created;
          }}
        />
      ) : null}

      {alertable.length === 0 ? (
        <EmptyState
          title="No sources to watch yet"
          description="Connect a source and its numbers become available here."
          action={
            <Button type="button" render={<a href="/connections" />}>
              Go to Connections
            </Button>
          }
        />
      ) : rules.length === 0 ? (
        <EmptyState
          title="No rules yet"
          description="A rule watches one number on one source and tells you when it crosses your line."
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rules.map((rule) => (
            <RuleItem
              key={rule.id}
              rule={rule}
              metric={metrics.find((m) => m.key === rule.metric)}
              onPatch={onPatch}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RuleItem({
  rule,
  metric,
  onPatch,
  onDelete,
}: {
  rule: RuleRow;
  metric: MetricOption | undefined;
  onPatch: Props["onPatch"];
  onDelete: Props["onDelete"];
}) {
  const muted = rule.mutedUntil && new Date(rule.mutedUntil) > new Date();
  /** Which rule a control acts on, for anyone who cannot see the row. */
  const name = `${metric?.label ?? rule.metric} on ${rule.connectionLabel}`;

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
          <SourceIcon provider={rule.provider} className="size-3.5" />
          <span className="font-medium">{metric?.label ?? rule.metric}</span>
          <span className="text-muted-foreground">
            {COMPARATOR_LABEL[rule.comparator]} {rule.threshold}
          </span>
          <span className="text-muted-foreground">· {rule.connectionLabel}</span>
        </p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {rule.lastState ? (
            <Badge
              variant={rule.lastState === "breached" ? "destructive" : "success"}
            >
              {rule.lastState === "breached" ? "Breached" : "OK"}
              {rule.lastValue ? ` · ${rule.lastValue}` : ""}
            </Badge>
          ) : (
            <Badge variant="outline">Not evaluated yet</Badge>
          )}
          <span>
            {rule.channelIds.length === 0
              ? "In-app only"
              : `${rule.channelIds.length} channel${
                  rule.channelIds.length === 1 ? "" : "s"
                }`}
          </span>
          {muted ? <span>· muted</span> : null}
        </p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={
          muted ? `Unmute rule: ${name}` : `Mute rule for 24 hours: ${name}`
        }
        onClick={() => onPatch(rule.id, { muteHours: muted ? 0 : 24 })}
      >
        <BellSlashIcon
          aria-hidden
          className={cn("size-4", muted && "text-warning")}
        />
      </Button>
      {/* A switch announces its own state, so the name is only the rule. */}
      <Switch
        checked={rule.enabled}
        aria-label={`Rule enabled: ${name}`}
        onCheckedChange={(checked) => onPatch(rule.id, { enabled: checked })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete rule: ${name}`}
        onClick={() => onDelete(rule.id)}
      >
        <TrashIcon className="size-4" aria-hidden />
      </Button>
    </li>
  );
}
