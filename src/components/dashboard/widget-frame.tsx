"use client";

import {
  ArrowSquareOutIcon,
  DotsSixVerticalIcon,
  GearSixIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SourceIcon } from "@/components/brand/source-icons";
import { PROVIDER_CATALOG } from "@/lib/connectors/catalog";
import { cn } from "@/lib/utils";
import { WidgetRenderer } from "@/components/dashboard/widget-renderer";
import type { WidgetConfig } from "@/lib/widgets/config";
import {
  getWidgetDefinition,
  type WidgetType,
} from "@/lib/widgets/registry";

type WidgetFrameProps = {
  id: string;
  type: WidgetType;
  title?: string | null;
  /** Which connection feeds this block. Null means the provider's default. */
  connectionId?: string | null;
  config?: WidgetConfig;
  /** The connection's own name, shown when several could answer. */
  sourceLabel?: string | null;
  editMode: boolean;
  onRemove: (id: string) => void;
  onConfigure?: (id: string) => void;
};

export function WidgetFrame({
  id,
  type,
  title,
  connectionId,
  config,
  sourceLabel,
  editMode,
  onRemove,
  onConfigure,
}: WidgetFrameProps) {
  const def = getWidgetDefinition(type);
  // Prefer live registry name when the stored title is a legacy default.
  const legacyTitles: Partial<Record<WidgetType, string[]>> = {
    "railway-tracker": [
      "Railway Tracker",
      "Railway Uptime",
      "Deploy Health",
    ],
    "supabase-health": ["Supabase Health", "Project Health"],
    "netlify-tracker": ["Netlify Tracker", "Deploy Health"],
    "qonto-balance": ["Qonto Balance", "Cash Balance"],
    "qonto-transactions": ["Qonto Transactions", "Recent Transactions"],
  };
  const legacy = legacyTitles[type];
  const heading =
    legacy && (!title || legacy.includes(title))
      ? def?.name || type
      : title || def?.name || type;
  const sourceName =
    def && def.provider !== "multi"
      ? PROVIDER_CATALOG[def.provider].name
      : "source";

  const subtitle =
    [sourceLabel, config?.scope].filter(Boolean).join(" · ") || null;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground",
        editMode && "border-dashed",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2",
          editMode && "drag-handle cursor-grab active:cursor-grabbing",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {editMode ? (
            <DotsSixVerticalIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : null}
          {def ? (
            <SourceIcon provider={def.provider} className="size-3.5" />
          ) : null}
          {/* A heading, so a screen reader can jump from widget to widget. */}
          <h2 className="truncate text-sm font-medium">{heading}</h2>
          {/*
            Which account, and what it is narrowed to.
            Only shown when it is not the obvious default: on a canvas with one
            Stripe account and no filter, saying so on every block is noise.
          */}
          {subtitle ? (
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {def?.sourceUrl ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={def.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${heading} in ${sourceName}`}
                    // The header doubles as the drag handle in edit mode, so
                    // keep the press from starting a drag instead of a click.
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon-sm" }),
                      "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <ArrowSquareOutIcon className="size-3.5" aria-hidden />
                  </a>
                }
              />
              <TooltipContent>Open in {sourceName}</TooltipContent>
            </Tooltip>
          ) : null}
          {editMode && onConfigure ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Configure ${heading}`}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onConfigure(id)}
            >
              <GearSixIcon className="size-3.5" aria-hidden />
            </Button>
          ) : null}
          {editMode ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove ${heading}`}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onRemove(id)}
            >
              <TrashIcon className="size-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
        <WidgetRenderer
          type={type}
          connectionId={connectionId}
          config={config}
        />
      </div>
    </div>
  );
}
