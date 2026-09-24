import { StatCard } from "@/components/dashboard/widgets/stat-card";
import { BarChart } from "@/components/dashboard/widgets/bar-chart";
import {
  DonutChart,
  LineChart,
} from "@/components/dashboard/widgets/lazy-charts";
import { NoData } from "@/components/dashboard/widgets/widget-messages";
import { formatMoney, formatSignedMoney } from "@/lib/format/money";
import type { ServedSnapshot } from "@/lib/widgets/snapshots";
import type { RenderersFor } from "./types";

type Data = ServedSnapshot<"qonto">;

function renderBalance(data: Data) {
  const balances = data.balances || [];
  const liquidity = data.liquidity;
  if (!balances.length || !liquidity) {
    return <NoData label="No Qonto accounts found." />;
  }
  const hint =
    balances.length === 1
      ? balances[0].accountName
      : `${balances.length} accounts`;
  return (
    <StatCard
      label="Total cash"
      value={formatMoney(liquidity.booked, liquidity.currency)}
      hint={hint}
    />
  );
}

function renderLiquidity(data: Data) {
  const liquidity = data.liquidity;
  if (!liquidity || liquidity.accountCount === 0) {
    return <NoData label="No Qonto accounts found." />;
  }
  const tied = Math.max(liquidity.pendingDelta, 0);
  return (
    <StatCard
      label="Available to spend"
      value={formatMoney(liquidity.available, liquidity.currency)}
      hint={
        tied > 0
          ? `${formatMoney(tied, liquidity.currency)} tied in pending`
          : "No pending hold"
      }
    />
  );
}

function renderCashflow(data: Data) {
  const cashflow = data.cashflow30d;
  if (!cashflow) {
    return <NoData label="No cashflow data yet." />;
  }
  const tone =
    cashflow.net > 0
      ? "positive"
      : cashflow.net < 0
        ? "negative"
        : "neutral";
  return (
    <StatCard
      label={`${cashflow.days}-day net`}
      value={formatSignedMoney(cashflow.net, cashflow.currency)}
      hint={`${cashflow.transactionCount} completed txs`}
      trend={
        cashflow.net > 0
          ? "Cash positive"
          : cashflow.net < 0
            ? "Cash negative"
            : "Flat"
      }
      trendTone={tone}
    />
  );
}

function renderInOut(data: Data) {
  const cashflow = data.cashflow30d;
  if (!cashflow) {
    return <NoData label="No cashflow data yet." />;
  }
  if (cashflow.inflow === 0 && cashflow.outflow === 0) {
    return <NoData label="No completed transactions in the last 30 days." />;
  }
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <BarChart
        rows={[
          {
            label: "In",
            value: cashflow.inflow,
            display: formatMoney(cashflow.inflow, cashflow.currency),
            tone: "in",
          },
          {
            label: "Out",
            value: cashflow.outflow,
            display: formatMoney(cashflow.outflow, cashflow.currency),
            tone: "out",
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        Last {cashflow.days} days · net{" "}
        <span className="tabular-nums">
          {formatSignedMoney(cashflow.net, cashflow.currency)}
        </span>
      </p>
    </div>
  );
}

function renderAccounts(data: Data) {
  const balances = data.balances || [];
  if (!balances.length) {
    return <NoData label="No Qonto accounts found." />;
  }
  return (
    <DonutChart
      label="Balance by account"
      items={balances.map((account, index) => ({
        id: `${account.accountName}-${index}`,
        name: account.accountName,
        value: account.balance,
        display: formatMoney(account.balance, account.currency),
        sharePct: account.sharePct ?? 0,
        highlight: account.main,
      }))}
    />
  );
}

function renderHistory(data: Data) {
  const history = data.balanceHistory;
  if (!history?.points?.length) {
    return <NoData label="No balance history yet." />;
  }
  const first = history.points[0]?.balance ?? 0;
  const last = history.points[history.points.length - 1]?.balance ?? 0;
  const delta = last - first;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium tabular-nums">
          {formatMoney(last, history.currency)}
        </p>
        <p
          className={
            delta > 0
              ? "text-xs tabular-nums text-success"
              : delta < 0
                ? "text-xs tabular-nums text-destructive"
                : "text-xs tabular-nums text-muted-foreground"
          }
        >
          {formatSignedMoney(delta, history.currency)} · {history.days}d
        </p>
      </div>
      <LineChart
        className="min-h-0 flex-1"
        label="Balance"
        points={history.points.map((point) => ({
          label: point.label,
          value: point.balance,
          display: formatMoney(point.balance, history.currency),
        }))}
      />
      <p className="text-[10px] text-muted-foreground">
        From settled transactions
        {history.incomplete ? " · partial window" : ""}
      </p>
    </div>
  );
}

/*
 * `qonto-transactions` is not here: it pages through the live API with a
 * cursor, so it has no snapshot to render and is registered as a read-through
 * widget instead.
 */
export const qontoRenderers: RenderersFor<"qonto"> = {
  "qonto-balance": renderBalance,
  "qonto-liquidity": renderLiquidity,
  "qonto-cashflow": renderCashflow,
  "qonto-in-out": renderInOut,
  "qonto-accounts": renderAccounts,
  "qonto-history": renderHistory,
};
