import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/widgets/stat-card";
import { DataTable } from "@/components/dashboard/widgets/data-table";
import { NoData } from "@/components/dashboard/widgets/widget-messages";
import { paymentBadgeVariant } from "@/lib/widgets/widget-format";
import { formatMoney } from "@/lib/format/money";
import type {
  MoneyPoint,
  PaymentItem,
  RevenueSummary,
} from "@/lib/connectors/types";

/*
 * Stripe and Lemon Squeezy report revenue in the same DTOs, so their widgets
 * are the same pictures fed from different fields. The pictures live here; the
 * two provider modules only say which field each widget reads — which is also
 * what keeps a share link for a Stripe board from carrying Lemon Squeezy's
 * field names in its allowlist.
 */

export function renderMrr(revenue: RevenueSummary | undefined) {
  if (!revenue) return <NoData label="No subscription data yet." />;
  return (
    <StatCard
      label="Monthly recurring revenue"
      value={formatMoney(revenue.mrr, revenue.currency.toUpperCase())}
      hint={`${revenue.activeSubscriptions} active${
        revenue.trialingSubscriptions > 0
          ? ` · ${revenue.trialingSubscriptions} trialing`
          : ""
      }`}
      trend={revenue.truncated ? "Partial — very large account" : undefined}
      trendTone="neutral"
    />
  );
}

/**
 * Trailing-30-day revenue. The volume point carries no currency of its own, so
 * it borrows the subscription summary's, falling back to the currency each
 * provider defaults to.
 */
export function renderRevenue30d({
  volume,
  revenue,
  fallbackCurrency,
  empty,
}: {
  volume: MoneyPoint | undefined;
  revenue: RevenueSummary | undefined;
  fallbackCurrency: string;
  empty: string;
}) {
  if (!volume) return <NoData label={empty} />;
  return (
    <StatCard
      label="Revenue (30 days)"
      value={formatMoney(
        volume.value,
        (revenue?.currency ?? fallbackCurrency).toUpperCase(),
      )}
      hint={volume.display}
    />
  );
}

export function renderPayments(payments: PaymentItem[] | undefined) {
  const rows = payments || [];
  if (rows.length === 0) {
    return <NoData label="No payments yet." />;
  }
  return (
    <DataTable
      data={rows}
      rowKey={(payment) => payment.id}
      columns={[
        {
          header: "Payment",
          render: (payment) => (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">
                {payment.description}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {payment.customer ||
                  format(new Date(payment.createdAt), "d MMM, HH:mm")}
              </span>
            </div>
          ),
        },
        {
          header: "Status",
          render: (payment) => (
            <Badge variant={paymentBadgeVariant(payment.status)}>
              {payment.status}
            </Badge>
          ),
        },
        {
          header: "Amount",
          align: "right",
          className: "font-medium tabular-nums",
          render: (payment) =>
            formatMoney(payment.amount, payment.currency.toUpperCase()),
        },
      ]}
    />
  );
}
