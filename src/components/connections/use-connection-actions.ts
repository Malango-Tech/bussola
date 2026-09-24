"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { readJson } from "@/components/api-client";
import { PROVIDER_CATALOG } from "@/lib/connectors/catalog";
import type { Provider } from "@/lib/providers";

/** "1 widget" / "3 widgets" as one text node, so no JSX whitespace surprises. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

type Target = { id: string; provider: Provider };

/**
 * Refresh, test and remove — the requests a connection card can make.
 *
 * Each one re-renders the server page afterwards rather than patching local
 * state: the health badge, last-synced time and error text all come from the
 * connection row, and the server is the only place that knows them.
 * `busy` names the connection with a request in flight, so its buttons can
 * stand down without disabling every other card.
 */
export function useConnectionActions(widgetCounts: Record<string, number>) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(
    id: string,
    path: string,
    messages: { ok: string; fail: string },
  ) {
    setBusy(id);
    try {
      const res = await fetch(path, { method: "POST" });
      const data = await readJson<{
        ok: boolean;
        error: string | null;
        result: { ok: boolean; message: string };
      }>(res);
      const ok = data.result ? data.result.ok : data.ok;
      const message = data.result?.message || data.error;

      if (ok) toast.success(message || messages.ok);
      else toast.error(message || messages.fail);

      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const refresh = (connection: Target) =>
    run(connection.id, `/api/connections/${connection.id}/sync`, {
      ok: "Refreshed",
      fail: "Refresh failed",
    });

  const test = (connection: Target) =>
    run(connection.id, `/api/connections/${connection.id}/test`, {
      ok: "Credentials work",
      fail: "Test failed",
    });

  async function remove(connection: Target) {
    const uses = widgetCounts[connection.provider] ?? 0;
    const warning =
      uses > 0 ? ` ${plural(uses, "widget")} will fall back to demo data.` : "";
    if (
      !window.confirm(
        `Remove the ${PROVIDER_CATALOG[connection.provider].name} connection?${warning}`,
      )
    ) {
      return;
    }

    setBusy(connection.id);
    try {
      const res = await fetch(`/api/connections?id=${connection.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error(
          (await readJson(res)).error || "Could not remove the connection",
        );
        return;
      }
      toast.success("Connection removed");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return { busy, refresh, test, remove };
}
