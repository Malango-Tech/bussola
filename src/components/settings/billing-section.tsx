"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { readJson } from "@/components/api-client";
import { SectionHeading } from "@/components/layout/page";
import { PermissionHint } from "@/components/layout/permission-hint";
import { useCan } from "@/components/providers/role-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Limits = {
  dashboards: number | null;
  seats: number | null;
  historyDays: number | null;
};

type BillingState = {
  enabled: boolean;
  planName: string;
  active: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  limits: Limits;
  usage: { connections: number; dashboards: number; seats: number };
  plans: Array<{
    id: string;
    name: string;
    monthlyCents: number | null;
    yearlyCents: number | null;
    currency: string;
    intervals: { monthly: boolean; yearly: boolean };
  }>;
};

type Interval = "monthly" | "yearly";

const PERMISSION_HINT_ID = "billing-permission-hint";

/**
 * Renders nothing unless this deployment actually takes payments, so the
 * self-hosted edition never shows a plan it does not have.
 */
export function BillingSection() {
  const [state, setState] = useState<BillingState | null>(null);
  const [interval, setInterval] = useState<Interval>("monthly");
  const [pending, setPending] = useState(false);
  // Everyone can see what the plan allows; only an owner can change what the
  // organization pays for, so the buttons stay visible but inert for others.
  const canManage = useCan("manageBilling");

  useEffect(() => {
    void fetch("/api/billing")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BillingState | null) => {
        if (data?.enabled) setState(data);
      })
      .catch(() => {
        /* billing is optional; stay silent when it is not available */
      });
  }, []);

  if (!state) return null;

  async function open(path: string, body?: unknown) {
    setPending(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await readJson<{ url: string }>(res);
      if (!res.ok || !data.url) {
        toast.error(data.error || "Could not reach the billing portal");
        return;
      }
      window.location.assign(data.url);
    } finally {
      setPending(false);
    }
  }

  const renews = state.currentPeriodEnd
    ? new Date(state.currentPeriodEnd).toLocaleDateString()
    : null;

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Plan"
        description="Billing is handled by Stripe."
        actions={
          <Badge variant={state.active ? "secondary" : "outline"}>
            {state.planName}
          </Badge>
        }
      />

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Usage
          label="Dashboards"
          used={state.usage.dashboards}
          limit={state.limits.dashboards}
        />
        <Usage label="Connections" used={state.usage.connections} limit={null} />
        <Usage
          label="Members"
          used={state.usage.seats}
          limit={state.limits.seats}
        />
        <Stat
          label="History"
          value={
            state.limits.historyDays === null
              ? "Unlimited"
              : `${state.limits.historyDays} days`
          }
        />
      </dl>

      {state.cancelAtPeriodEnd && renews ? (
        <p className="text-sm text-muted-foreground">
          Your plan ends on {renews}.
        </p>
      ) : renews ? (
        <p className="text-sm text-muted-foreground">Renews {renews}.</p>
      ) : null}

      {!canManage ? (
        <PermissionHint permission="manageBilling" id={PERMISSION_HINT_ID}>
          change the plan or billing details
        </PermissionHint>
      ) : null}

      {state.plans.length > 0 ? (
        <div className="space-y-3">
          <IntervalToggle value={interval} onChange={setInterval} />
          <div className="flex flex-wrap gap-2">
            {state.plans
              .filter((plan) => plan.intervals[interval])
              .map((plan) => (
                <Button
                  key={plan.id}
                  variant="outline"
                  size="sm"
                  disabled={pending || !canManage}
                  aria-describedby={canManage ? undefined : PERMISSION_HINT_ID}
                  onClick={() =>
                    open("/api/billing/checkout", { plan: plan.id, interval })
                  }
                >
                  {plan.name} · {formatPrice(plan, interval)}
                </Button>
              ))}
          </div>
        </div>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        disabled={pending || !canManage}
        aria-describedby={canManage ? undefined : PERMISSION_HINT_ID}
        onClick={() => open("/api/billing/portal")}
      >
        Manage billing
      </Button>
    </section>
  );
}

function formatPrice(
  plan: BillingState["plans"][number],
  interval: Interval,
): string {
  const cents = interval === "yearly" ? plan.yearlyCents : plan.monthlyCents;
  if (cents === null) return "—";
  const amount = (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: plan.currency.toUpperCase(),
    maximumFractionDigits: 0,
  });
  return interval === "yearly" ? `${amount}/yr` : `${amount}/mo`;
}

function IntervalToggle({
  value,
  onChange,
}: {
  value: Interval;
  onChange: (next: Interval) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Billing interval"
      className="inline-flex rounded-lg border border-border p-0.5"
    >
      {(["monthly", "yearly"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-[calc(var(--radius-md)-2px)] px-2.5 py-1 text-xs font-medium capitalize transition-colors",
            value === option
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Usage({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number | null;
}) {
  return (
    <Stat
      label={label}
      value={
        <>
          {used}
          <span className="text-muted-foreground">
            {limit === null ? " / ∞" : ` / ${limit}`}
          </span>
        </>
      }
    />
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
