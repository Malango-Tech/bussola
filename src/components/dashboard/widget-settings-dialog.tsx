"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  LIMIT_CHOICES,
  RANGE_CHOICES,
  isMultiSource,
  optionsFor,
  scopeValuesFor,
  type WidgetConfig,
} from "@/lib/widgets/config";
import { getWidgetDefinition, type WidgetType } from "@/lib/widgets/registry";
import { useWidgetData } from "@/lib/widgets/widget-data-store";
import type { ConnectionOption } from "@/components/dashboard/dashboard-canvas";

export type WidgetSettingsTarget = {
  id: string;
  widgetType: WidgetType;
  title: string | null;
  connectionId: string | null;
  config: WidgetConfig;
};

type Props = {
  widget: WidgetSettingsTarget;
  connections: ConnectionOption[];
  onClose: () => void;
  onSave: (patch: {
    title: string | null;
    connectionId: string | null;
    config: WidgetConfig;
  }) => Promise<boolean>;
};

/** Sentinel for "no scope filter", since a select cannot carry undefined. */
const ANY = "__any__";

/**
 * Everything about one widget that is not its position.
 *
 * Which controls appear is decided by the widget's own payload shape, so this
 * dialog never offers a filter the data cannot honour — a single-number card
 * gets a title and a source and nothing else, which is the whole truth about
 * what can be changed on it.
 */
export function WidgetSettingsDialog({
  widget,
  connections,
  onClose,
  onSave,
}: Props) {
  const def = getWidgetDefinition(widget.widgetType);
  const options = optionsFor(widget.widgetType);

  const [title, setTitle] = useState(widget.title ?? "");
  const [connectionId, setConnectionId] = useState(widget.connectionId ?? "");
  const [scope, setScope] = useState(widget.config.scope ?? ANY);
  const [limit, setLimit] = useState(widget.config.limit ?? 0);
  const [rangeDays, setRangeDays] = useState(widget.config.rangeDays ?? 0);
  const [saving, setSaving] = useState(false);

  /*
   * Cross-source widgets carry an explicit connection set. A widget created
   * before that existed has none, which historically meant "all" — so an
   * undefined set opens with everything ticked rather than nothing, and saving
   * writes it out.
   */
  const multiSource = isMultiSource(widget.widgetType);
  const [connectionIds, setConnectionIds] = useState<string[]>(
    () =>
      widget.config.connectionIds ??
      (multiSource ? connections.map((c) => c.id) : []),
  );

  /*
   * Scope choices come from the data the widget is already showing, read
   * through whichever connection is selected *in the dialog* — so switching
   * source repopulates the list instead of offering the old account's
   * projects. This subscribes to the same shared poll loop the widget behind
   * the dialog uses, so it costs no extra request in the common case.
   */
  const { data } = useWidgetData(
    widget.widgetType,
    connectionId || widget.connectionId,
  );

  const scopeValues = useMemo(
    () => scopeValuesFor(widget.widgetType, data),
    [widget.widgetType, data],
  );

  /*
   * A stored scope that no longer exists upstream falls back to "everything".
   *
   * Derived rather than corrected in an effect: an effect would render the
   * select once with a value none of its options carry — which browsers show
   * as blank — and could write the fallback back to the server on a save that
   * raced it. `scopeValues` being empty means the widget has not loaded yet,
   * which is not evidence that the scope is stale.
   */
  const effectiveScope =
    scope !== ANY && scopeValues.length > 0 && !scopeValues.includes(scope)
      ? ANY
      : scope;

  /** Connections this widget could read: same provider, plus the default. */
  const candidates = useMemo(() => {
    if (!def || def.provider === "multi") return [];
    return connections.filter((c) => c.provider === def.provider);
  }, [connections, def]);

  async function save() {
    setSaving(true);
    const ok = await onSave({
      title: title.trim() || null,
      connectionId: connectionId || null,
      config: {
        scope: effectiveScope === ANY ? undefined : effectiveScope,
        limit: limit > 0 ? limit : undefined,
        rangeDays: rangeDays > 0 ? rangeDays : undefined,
        connectionIds: multiSource ? connectionIds : undefined,
      },
    });
    setSaving(false);
    if (ok) {
      toast.success("Widget updated");
      onClose();
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{def?.name ?? "Widget"} settings</DialogTitle>
          <DialogDescription>
            {def?.description ?? "Change what this block shows."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="widget-title">Title</Label>
            <Input
              id="widget-title"
              value={title}
              placeholder={def?.name ?? ""}
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use the default name.
            </p>
          </div>

          {candidates.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="widget-connection">Source</Label>
              <Select
                id="widget-connection"
                value={connectionId}
                onChange={(event) => {
                  setConnectionId(event.target.value);
                  // Scopes belong to an account; carrying one across would
                  // filter the new source by a name it has never heard of.
                  setScope(ANY);
                }}
              >
                <option value="">
                  Default ({candidates[0]?.label ?? "first connection"})
                </option>
                {candidates.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.label}
                  </option>
                ))}
              </Select>
              {candidates.length > 1 ? (
                <p className="text-xs text-muted-foreground">
                  {candidates.length} connections for this source.
                </p>
              ) : null}
            </div>
          ) : null}

          {multiSource ? (
            <div
              className="space-y-1.5"
              role="group"
              aria-labelledby="widget-sources-label"
            >
              <Label id="widget-sources-label">Sources</Label>
              {connections.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing connected yet.
                </p>
              ) : (
                <div className="space-y-1.5 rounded-lg border border-border p-2.5">
                  {connections.map((connection) => {
                    const on = connectionIds.includes(connection.id);
                    return (
                      <label
                        key={connection.id}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {connection.label}
                        </span>
                        <Switch
                          checked={on}
                          aria-label={`Include ${connection.label}`}
                          onCheckedChange={(checked) =>
                            setConnectionIds((prev) =>
                              checked
                                ? [...new Set([...prev, connection.id])]
                                : prev.filter((id) => id !== connection.id),
                            )
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {connectionIds.length === 0
                  ? "No sources selected — this block will be empty."
                  : "A shared link shows only what is selected here."}
              </p>
            </div>
          ) : null}

          {options.includes("scope") ? (
            <div className="space-y-1.5">
              <Label htmlFor="widget-scope">Show only</Label>
              <Select
                id="widget-scope"
                value={effectiveScope}
                onChange={(event) => setScope(event.target.value)}
                disabled={scopeValues.length === 0}
              >
                <option value={ANY}>Everything</option>
                {scopeValues.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                {scopeValues.length === 0
                  ? "Nothing to filter by yet — this fills in once the source has synced."
                  : "Narrow this block to one project, service or account."}
              </p>
            </div>
          ) : null}

          {options.includes("limit") ? (
            <div className="space-y-1.5">
              <Label htmlFor="widget-limit">Rows</Label>
              <Select
                id="widget-limit"
                value={String(limit)}
                onChange={(event) => setLimit(Number(event.target.value))}
              >
                <option value="0">As many as fit</option>
                {LIMIT_CHOICES.map((choice) => (
                  <option key={choice} value={String(choice)}>
                    {choice} rows
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {options.includes("range") ? (
            <div className="space-y-1.5">
              <Label htmlFor="widget-range">Time range</Label>
              <Select
                id="widget-range"
                value={String(rangeDays)}
                onChange={(event) => setRangeDays(Number(event.target.value))}
              >
                <option value="0">Everything the source reports</option>
                {RANGE_CHOICES.map((choice) => (
                  <option key={choice} value={String(choice)}>
                    Last {choice} days
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Trims the chart to a window of what the source already sent.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
