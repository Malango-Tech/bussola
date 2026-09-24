"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { format } from "date-fns";
import { WidgetMessage } from "@/components/dashboard/widgets/widget-messages";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format/money";
import { useWidgetDataEndpoint } from "@/lib/widgets/widget-data-store";
import type { TransactionItem } from "@/lib/connectors/types";

const ROW_HEIGHT_PX = 52;
const HEADER_HEIGHT_PX = 36;
const MIN_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 40;

function txStatusVariant(
  status?: TransactionItem["status"],
): "secondary" | "outline" | "destructive" {
  switch (status) {
    case "pending":
      return "secondary";
    case "declined":
    case "reversed":
      return "destructive";
    case "completed":
    case undefined:
      return "outline";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function pageSizeForHeight(height: number): number {
  const usable = Math.max(height - HEADER_HEIGHT_PX, ROW_HEIGHT_PX);
  const fitted = Math.ceil(usable / ROW_HEIGHT_PX) + 4;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, fitted));
}

type QontoTransactionsWidgetProps = {
  /**
   * Which Qonto connection to read. Absent means the organization's default.
   *
   * Repointing the widget at another account invalidates everything loaded so
   * far — the cursor belongs to the old account's page sequence, and appending
   * to it would interleave two businesses' transactions. The caller keys this
   * component on the connection so React discards the state for us, rather
   * than an effect resetting six pieces of it by hand.
   */
  connectionId?: string | null;
  /** Rows per page, when the widget's settings pin one. */
  limit?: number;
};

export function QontoTransactionsWidget({
  connectionId,
  limit: limitOverride,
}: QontoTransactionsWidgetProps = {}) {
  // Cursor pagination is this widget's own, so it fetches directly rather than
  // through the shared store — but it must still read from wherever the rest
  // of the page reads, share link included.
  const endpoint = useWidgetDataEndpoint();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const nextCursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const loadingLock = useRef(false);

  const [height, setHeight] = useState(0);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [needsConnection, setNeedsConnection] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const update = () => setHeight(node.clientHeight);
    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fetchPage = useCallback(
    async (mode: "replace" | "append") => {
      if (loadingLock.current) return;
      if (mode === "append" && !hasMoreRef.current) return;

      loadingLock.current = true;
      if (mode === "append") setLoadingMore(true);
      else setLoading(true);

      // A pinned limit wins over the height estimate: someone who asked for
      // ten rows means ten, not "however many fit".
      const limit = limitOverride ?? pageSizeForHeight(height || 240);
      const params = new URLSearchParams({
        type: "qonto-transactions",
        limit: String(limit),
      });
      if (connectionId) params.set("connectionId", connectionId);
      if (mode === "append" && nextCursorRef.current) {
        params.set("cursor", nextCursorRef.current);
      }

      try {
        const res = await fetch(`${endpoint}?${params.toString()}`);
        const json = (await res.json()) as {
          error?: string;
          needsConnection?: boolean;
          transactions?: TransactionItem[];
          nextCursor?: string | null;
          hasMore?: boolean;
        };
        if (!res.ok) throw new Error(json.error || "Failed to load");

        if (json.needsConnection) {
          setNeedsConnection(true);
          setTransactions([]);
          hasMoreRef.current = false;
          nextCursorRef.current = null;
          setHasMore(false);
          setError(null);
          return;
        }

        const page = json.transactions || [];
        nextCursorRef.current = json.nextCursor ?? null;
        hasMoreRef.current = Boolean(json.hasMore);
        setHasMore(hasMoreRef.current);
        setNeedsConnection(false);
        setError(null);
        setTransactions((prev) => {
          if (mode === "replace") return page;
          const seen = new Set(prev.map((tx) => tx.id));
          return [...prev, ...page.filter((tx) => !seen.has(tx.id))];
        });
      } catch {
        if (mode === "replace") {
          setError("Couldn’t load transactions. Try reconnecting Qonto.");
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
        loadingLock.current = false;
      }
    },
    [height, connectionId, limitOverride, endpoint],
  );

  const didInitialLoad = useRef(false);

  useEffect(() => {
    if (height <= 0) return;
    if (!didInitialLoad.current) {
      didInitialLoad.current = true;
      nextCursorRef.current = null;
      hasMoreRef.current = true;
      void fetchPage("replace");
      return;
    }
    // Widget grew taller than loaded rows — pull more to fill the viewport.
    const needed = pageSizeForHeight(height);
    if (transactions.length > 0 && transactions.length < needed && hasMoreRef.current) {
      void fetchPage("append");
    }
  }, [height, fetchPage, transactions.length]);

  useEffect(() => {
    if (needsConnection) return;
    const timer = setInterval(() => {
      nextCursorRef.current = null;
      hasMoreRef.current = true;
      void fetchPage("replace");
    }, 60_000);
    return () => clearInterval(timer);
  }, [fetchPage, needsConnection]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || needsConnection || error) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchPage("append");
        }
      },
      { root, rootMargin: "120px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchPage, needsConnection, error, transactions.length]);

  if (needsConnection) {
    return (
      <div ref={rootRef} className="h-full">
        <WidgetMessage
          title="Connect Qonto to see this widget."
          action={{ href: "/connections", label: "Open Connections" }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div ref={rootRef} className="h-full">
        <WidgetMessage
          title={error}
          action={{ href: "/connections", label: "Check Connections" }}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      {loading && transactions.length === 0 ? (
        <div className="space-y-2 p-1" aria-busy="true">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
          <span className="sr-only">Loading transactions</span>
        </div>
      ) : transactions.length === 0 ? (
        <WidgetMessage title="No recent transactions." />
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
        >
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="h-9">Label</TableHead>
                <TableHead className="h-9">Date</TableHead>
                <TableHead className="h-9 text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => (
                <TableRow key={tx.id} className="h-[52px]">
                  <TableCell className="py-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium leading-tight">
                        {tx.label}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {tx.status && tx.status !== "completed" ? (
                          <Badge variant={txStatusVariant(tx.status)}>
                            {tx.status}
                          </Badge>
                        ) : null}
                        {tx.accountName ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {tx.accountName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-muted-foreground">
                    {format(new Date(tx.settledAt), "MMM d")}
                  </TableCell>
                  <TableCell
                    className={
                      tx.side === "credit"
                        ? "py-2 text-right tabular-nums text-success"
                        : "py-2 text-right tabular-nums"
                    }
                  >
                    {tx.side === "credit" ? "+" : "−"}
                    {formatMoney(tx.amount, tx.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div
            ref={sentinelRef}
            className="flex h-8 items-center justify-center"
          >
            {loadingMore ? (
              <span className="text-xs text-muted-foreground">Loading more…</span>
            ) : hasMore ? (
              <span className="text-xs text-muted-foreground/70">
                Scroll for more
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/70">End of list</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
