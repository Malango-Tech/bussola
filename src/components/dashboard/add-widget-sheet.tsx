"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { SourceIcon, getSourceMeta } from "@/components/brand/source-icons";
import { ConnectionDialog } from "@/components/connections/connection-dialog";
const WidgetPreview = dynamic(
  () =>
    import("@/components/dashboard/widget-previews").then(
      (m) => m.WidgetPreview,
    ),
  { ssr: false },
);
import { WIDGET_REGISTRY, type WidgetType } from "@/lib/widgets/registry";
import type { Provider } from "@/lib/providers";
import { cn } from "@/lib/utils";

type ConnectionSummary = {
  provider: Provider;
  status: string;
};

function isConnected(
  provider: Provider | "multi",
  connected: Set<Provider>,
): boolean {
  if (provider === "multi") {
    return (
      connected.has("railway") ||
      connected.has("netlify") ||
      connected.has("supabase")
    );
  }
  return connected.has(provider);
}

export function AddWidgetSheet({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (type: WidgetType) => Promise<void>;
}) {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showUnconnected, setShowUnconnected] = useState(false);
  const [connecting, setConnecting] = useState<Provider | null>(null);

  const refreshConnections = useCallback(() => {
    void fetch("/api/connections")
      .then((r) => r.json())
      .then((data: { connections?: ConnectionSummary[] }) => {
        setConnections(data.connections || []);
      });
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshConnections();
  }, [open, refreshConnections]);

  const connected = useMemo(
    () =>
      new Set(
        connections
          .filter((c) => c.status === "connected" || c.status === "unknown")
          .map((c) => c.provider),
      ),
    [connections],
  );

  const widgets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return WIDGET_REGISTRY.filter((widget) => {
      const live = isConnected(widget.provider, connected);
      if (!showUnconnected && !live) return false;
      if (!q) return true;
      const haystack = `${widget.name} ${widget.description} ${widget.provider}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [connected, query, showUnconnected]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
          setShowUnconnected(false);
        }
      }}
    >
      <SheetTrigger render={<Button type="button">Add widget</Button>} />
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add widget</SheetTitle>
          <SheetDescription>
            Gallery of blocks from your connected sources.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4">
          <div className="relative">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Search widgets"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search widgets…"
              className="pl-8"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="show-unconnected" className="text-sm font-normal">
              Show unconnected
            </Label>
            <Switch
              id="show-unconnected"
              checked={showUnconnected}
              onCheckedChange={setShowUnconnected}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-6">
          {widgets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <p className="text-sm font-medium">No widgets to show</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {connected.size === 0
                  ? "Connect a source first, or enable “Show unconnected”."
                  : "Try another search."}
              </p>
              {connected.size === 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  nativeButton={false}
                  render={<Link href="/connections" />}
                >
                  Open Connections
                </Button>
              ) : null}
            </div>
          ) : (
            widgets.map((widget) => {
              const live = isConnected(widget.provider, connected);
              const sourceLabel = getSourceMeta(widget.provider).title;
              const provider =
                widget.provider === "multi" ? null : widget.provider;

              return (
                <div
                  key={widget.type}
                  className={cn(
                    "rounded-lg border border-border p-3",
                    !live && "opacity-80",
                  )}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <SourceIcon
                          provider={widget.provider}
                          className="size-4"
                        />
                        <p className="truncate font-medium">{widget.name}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {widget.description}
                      </p>
                    </div>
                    {live ? (
                      <Badge variant="secondary">Ready</Badge>
                    ) : (
                      <Badge variant="outline">Connect {sourceLabel}</Badge>
                    )}
                  </div>

                  <WidgetPreview type={widget.type} className="mb-3" />

                  {live ? (
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      // Every card has this button; the name says which one.
                      aria-label={`Add to dashboard: ${widget.name}`}
                      disabled={pending === widget.type}
                      onClick={async () => {
                        setPending(widget.type);
                        await onAdd(widget.type);
                        setPending(null);
                        onOpenChange(false);
                      }}
                    >
                      {pending === widget.type ? "Adding…" : "Add to dashboard"}
                    </Button>
                  ) : provider === null ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      nativeButton={false}
                      render={<Link href="/connections" />}
                    >
                      Connect {sourceLabel}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => setConnecting(provider)}
                    >
                      Connect {sourceLabel}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SheetContent>

      {connecting ? (
        <ConnectionDialog
          provider={connecting}
          onClose={() => setConnecting(null)}
          onSaved={() => {
            setConnecting(null);
            refreshConnections();
          }}
        />
      ) : null}
    </Sheet>
  );
}
