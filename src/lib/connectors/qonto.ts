import { format } from "date-fns";
import type {
  BalanceHistory,
  BalanceInfo,
  CashflowPeriod,
  ConnectionCredentials,
  Connector,
  LiquidityInfo,
  QontoDashboard,
  QontoTransactionsPage,
  TestResult,
  TransactionItem,
} from "./types";
import { toUserFacingError } from "./errors";
import { fetchJson } from "./http";
import { byNewest, daysAgo } from "./shared/dates";
import { connectorLogger } from "./shared/log";
import { majorOrMinor } from "./shared/money";
import { collectPages } from "./shared/pagination";

const BASE = "https://thirdparty.qonto.com/v2";
const TX_PER_PAGE = 100;
const TX_MAX_PAGES = 5;
const CASHFLOW_DAYS = 30;
const FEED_FETCH_MULTIPLIER = 2;

const log = connectorLogger("qonto");

function authHeader(credentials: ConnectionCredentials): string {
  // Qonto API key auth is NOT HTTP Basic: send the raw `login:secret` string.
  // Docs: Authorization: {login}:{secret-key} — no "Basic", no Base64.
  // OAuth access tokens use Bearer instead.
  const login = credentials.login?.trim();
  const secretKey = credentials.secretKey?.trim();
  if (login && secretKey) {
    return `${login}:${secretKey}`;
  }

  const apiKey = credentials.apiKey?.trim();
  if (apiKey?.includes(":")) {
    return apiKey;
  }
  if (apiKey) {
    return `Bearer ${apiKey}`;
  }
  throw new Error("Qonto credentials missing");
}

async function qontoFetch<T>(
  credentials: ConnectionCredentials,
  path: string,
): Promise<T> {
  return fetchJson<T>(
    `${BASE}${path}`,
    {
      headers: {
        Authorization: authHeader(credentials),
        "Content-Type": "application/json",
      },
    },
    { label: "Qonto" },
  );
}

type QontoBankAccount = {
  id: string;
  name?: string;
  slug?: string;
  balance?: number;
  balance_cents?: number;
  authorized_balance?: number;
  authorized_balance_cents?: number;
  currency?: string;
  status?: string;
  main?: boolean;
  is_external_account?: boolean;
};

type QontoOrg = {
  organization: {
    name?: string;
    slug?: string;
    bank_accounts?: QontoBankAccount[];
  };
};

type QontoTxRaw = {
  id: string;
  label?: string;
  amount?: number;
  amount_cents?: number;
  side?: string;
  currency?: string;
  status?: string;
  settled_at?: string;
  emitted_at?: string;
  bank_account_id?: string;
};

type QontoTransactionsPageRaw = {
  transactions: QontoTxRaw[];
  meta?: {
    next_page?: number | null;
    current_page?: number;
    total_pages?: number;
  };
};

function mapAccount(account: QontoBankAccount): BalanceInfo {
  return {
    currency: account.currency || "EUR",
    balance: majorOrMinor(account.balance, account.balance_cents),
    authorizedBalance: majorOrMinor(
      account.authorized_balance,
      account.authorized_balance_cents,
    ),
    accountName: account.name || account.slug || "Account",
    main: Boolean(account.main),
  };
}

function mapTransaction(
  tx: QontoTxRaw,
  accountName?: string,
): TransactionItem {
  const amount = majorOrMinor(tx.amount, tx.amount_cents);
  const side = tx.side === "credit" ? "credit" : "debit";
  const statusRaw = (tx.status || "completed").toLowerCase();
  const status =
    statusRaw === "pending" ||
    statusRaw === "declined" ||
    statusRaw === "reversed" ||
    statusRaw === "completed"
      ? statusRaw
      : "completed";

  return {
    id: tx.id,
    label: tx.label || "Transaction",
    amount,
    currency: tx.currency || "EUR",
    side,
    settledAt: tx.settled_at || tx.emitted_at || new Date().toISOString(),
    status,
    accountName,
  };
}

async function listActiveAccounts(
  credentials: ConnectionCredentials,
): Promise<{
  organizationName?: string;
  accounts: QontoBankAccount[];
  accountNameById: Map<string, string>;
}> {
  const org = await qontoFetch<QontoOrg>(credentials, "/organization");
  const accounts = (org.organization.bank_accounts || []).filter(
    (account) => account.status !== "closed" && !account.is_external_account,
  );
  return {
    organizationName: org.organization.name || org.organization.slug,
    accounts,
    accountNameById: new Map(
      accounts.map((account) => [
        account.id,
        account.name || account.slug || "Account",
      ]),
    ),
  };
}

async function fetchAccountTransactions(
  credentials: ConnectionCredentials,
  accountId: string,
  settledFrom: string,
): Promise<{ transactions: QontoTxRaw[]; truncated: boolean }> {
  const { items, truncated } = await collectPages<QontoTxRaw, number>(
    async (page = 1) => {
      const params = new URLSearchParams({
        bank_account_id: accountId,
        per_page: String(TX_PER_PAGE),
        page: String(page),
        sort_by: "settled_at:desc",
        settled_at_from: settledFrom,
      });
      // Include pending so the recent list stays useful; cashflow filters completed.
      params.append("status[]", "completed");
      params.append("status[]", "pending");

      const data = await qontoFetch<QontoTransactionsPageRaw>(
        credentials,
        `/transactions?${params.toString()}`,
      );
      const batch = data.transactions || [];
      const next = data.meta?.next_page;
      return { items: batch, next: next && batch.length > 0 ? next : null };
    },
    TX_MAX_PAGES,
  );

  return { transactions: items, truncated };
}

async function fetchAccountTransactionsPage(
  credentials: ConnectionCredentials,
  accountId: string,
  options: {
    limit: number;
    settledTo?: string;
  },
): Promise<{ transactions: QontoTxRaw[]; exhausted: boolean }> {
  const params = new URLSearchParams({
    bank_account_id: accountId,
    per_page: String(options.limit),
    page: "1",
    sort_by: "settled_at:desc",
  });
  params.append("status[]", "completed");
  params.append("status[]", "pending");
  if (options.settledTo) {
    params.set("settled_at_to", options.settledTo);
  }

  const data = await qontoFetch<QontoTransactionsPageRaw>(
    credentials,
    `/transactions?${params.toString()}`,
  );
  const transactions = data.transactions || [];
  const exhausted =
    transactions.length < options.limit && !data.meta?.next_page;
  return { transactions, exhausted };
}

function buildLiquidity(accounts: BalanceInfo[]): LiquidityInfo {
  const currency = accounts[0]?.currency || "EUR";
  const booked = accounts.reduce((sum, a) => sum + a.balance, 0);
  const available = accounts.reduce(
    (sum, a) => sum + (a.authorizedBalance ?? a.balance),
    0,
  );
  return {
    currency,
    booked,
    available,
    pendingDelta: booked - available,
    accountCount: accounts.length,
  };
}

function buildCashflow(transactions: TransactionItem[]): CashflowPeriod {
  const currency = transactions[0]?.currency || "EUR";
  let inflow = 0;
  let outflow = 0;
  let count = 0;

  for (const tx of transactions) {
    if (tx.status && tx.status !== "completed") continue;
    count += 1;
    if (tx.side === "credit") inflow += tx.amount;
    else outflow += tx.amount;
  }

  return {
    currency,
    inflow,
    outflow,
    net: inflow - outflow,
    days: CASHFLOW_DAYS,
    transactionCount: count,
  };
}

function withShare(accounts: BalanceInfo[]): BalanceInfo[] {
  const total = accounts.reduce((sum, a) => sum + Math.max(a.balance, 0), 0);
  return accounts
    .map((account) => ({
      ...account,
      sharePct:
        total > 0
          ? Math.round((Math.max(account.balance, 0) / total) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => {
      if (a.main === b.main) return b.balance - a.balance;
      return a.main ? -1 : 1;
    });
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Reconstruct daily booked balance from current balance + completed txs.
 * Qonto has no native balance-history endpoint — this walks the settled trail.
 */
function buildBalanceHistory(
  currentBooked: number,
  currency: string,
  transactions: TransactionItem[],
  days: number,
  incomplete: boolean,
): BalanceHistory {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    keys.push(dayKey(d.toISOString()));
  }

  const dailyNet = new Map<string, number>();
  for (const key of keys) dailyNet.set(key, 0);

  for (const tx of transactions) {
    if (tx.status && tx.status !== "completed") continue;
    const key = dayKey(tx.settledAt);
    if (!dailyNet.has(key)) continue;
    const signed = tx.side === "credit" ? tx.amount : -tx.amount;
    dailyNet.set(key, (dailyNet.get(key) || 0) + signed);
  }

  const endBalances = new Array<number>(keys.length);
  endBalances[keys.length - 1] = currentBooked;
  for (let i = keys.length - 2; i >= 0; i -= 1) {
    const nextKey = keys[i + 1];
    const nextNet = dailyNet.get(nextKey) || 0;
    endBalances[i] = endBalances[i + 1] - nextNet;
  }

  return {
    currency,
    days,
    incomplete,
    points: keys.map((date, index) => ({
      date,
      label: format(new Date(`${date}T12:00:00.000Z`), "MMM d"),
      balance: Math.round(endBalances[index] * 100) / 100,
    })),
  };
}

export const qontoConnector: Connector = {
  provider: "qonto",
  async test(credentials: ConnectionCredentials): Promise<TestResult> {
    try {
      const data = await qontoFetch<QontoOrg>(credentials, "/organization");
      return {
        ok: true,
        message: `Connected to ${data.organization.name || data.organization.slug || "Qonto org"}`,
      };
    } catch (error) {
      return {
        ok: false,
        message: toUserFacingError(error, "qonto"),
      };
    }
  },
};

export async function fetchQontoDashboard(
  credentials: ConnectionCredentials,
): Promise<QontoDashboard> {
  const { organizationName, accounts, accountNameById } =
    await listActiveAccounts(credentials);

  const balances = withShare(accounts.map(mapAccount));
  const liquidity = buildLiquidity(balances);

  const settledFrom = daysAgo(CASHFLOW_DAYS).toISOString();

  const txBatches = await Promise.all(
    accounts.map(async (account) => {
      try {
        return await fetchAccountTransactions(
          credentials,
          account.id,
          settledFrom,
        );
      } catch (error) {
        // The balance still renders, but this account's cashflow and history
        // now count as zero — a number that looks real, so leave a trace.
        log.warn(
          "account transactions unavailable",
          { accountId: account.id },
          error,
        );
        return { transactions: [] as QontoTxRaw[], truncated: false };
      }
    }),
  );

  const allTx = txBatches
    .flatMap((batch) => batch.transactions)
    .map((tx) =>
      mapTransaction(
        tx,
        tx.bank_account_id
          ? accountNameById.get(tx.bank_account_id)
          : undefined,
      ),
    )
    .sort(byNewest((tx) => tx.settledAt));

  const historyIncomplete = txBatches.some((batch) => batch.truncated);

  return {
    organizationName,
    balances,
    liquidity,
    cashflow30d: buildCashflow(allTx),
    balanceHistory: buildBalanceHistory(
      liquidity.booked,
      liquidity.currency,
      allTx,
      CASHFLOW_DAYS,
      historyIncomplete,
    ),
  };
}

function encodeTxCursor(tx: TransactionItem): string {
  return `${tx.settledAt}__${tx.id}`;
}

function decodeTxCursor(
  cursor?: string | null,
): { settledAt: string; id: string } | null {
  if (!cursor) return null;
  const split = cursor.indexOf("__");
  if (split <= 0) return { settledAt: cursor, id: "" };
  return {
    settledAt: cursor.slice(0, split),
    id: cursor.slice(split + 2),
  };
}

function isBeforeCursor(
  tx: TransactionItem,
  cursor: { settledAt: string; id: string },
): boolean {
  const txTime = new Date(tx.settledAt).getTime();
  const cursorTime = new Date(cursor.settledAt).getTime();
  if (txTime < cursorTime) return true;
  if (txTime > cursorTime) return false;
  // Same timestamp: keep only ids that sort after the cursor id (desc feed → id < cursor id).
  return cursor.id ? tx.id < cursor.id : false;
}

/**
 * Cursor-paginated recent transactions across all active accounts.
 * Cursor format: `${settledAt}__${id}`.
 */
export async function fetchQontoTransactionsPage(
  credentials: ConnectionCredentials,
  options: {
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<QontoTransactionsPage> {
  const limit = Math.min(Math.max(options.limit ?? 20, 5), 50);
  const decoded = decodeTxCursor(options.cursor);
  const { accounts, accountNameById } = await listActiveAccounts(credentials);

  if (accounts.length === 0) {
    return { transactions: [], nextCursor: null, hasMore: false };
  }

  const fetchLimit = Math.min(limit * FEED_FETCH_MULTIPLIER, TX_PER_PAGE);
  const batches = await Promise.all(
    accounts.map(async (account) => {
      try {
        return await fetchAccountTransactionsPage(credentials, account.id, {
          limit: fetchLimit,
          settledTo: decoded?.settledAt,
        });
      } catch (error) {
        // The feed carries on with the other accounts.
        log.warn(
          "account transaction page unavailable",
          { accountId: account.id },
          error,
        );
        return { transactions: [] as QontoTxRaw[], exhausted: true };
      }
    }),
  );

  const merged = batches
    .flatMap((batch) => batch.transactions)
    .map((tx) =>
      mapTransaction(
        tx,
        tx.bank_account_id
          ? accountNameById.get(tx.bank_account_id)
          : undefined,
      ),
    )
    .filter((tx) => (decoded ? isBeforeCursor(tx, decoded) : true))
    .sort((a, b) => {
      const delta =
        new Date(b.settledAt).getTime() - new Date(a.settledAt).getTime();
      if (delta !== 0) return delta;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

  const seen = new Set<string>();
  const unique: TransactionItem[] = [];
  for (const tx of merged) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    unique.push(tx);
  }

  const page = unique.slice(0, limit);
  const last = page[page.length - 1];
  const anyAccountHasMore = batches.some((batch) => !batch.exhausted);
  const hasMore =
    unique.length > limit || (page.length > 0 && anyAccountHasMore);

  return {
    transactions: page,
    nextCursor: last && hasMore ? encodeTxCursor(last) : null,
    hasMore: Boolean(last && hasMore),
  };
}
