import type { ComponentType, ReactNode } from "react";
import { QontoTransactionsWidget } from "@/components/dashboard/qonto-transactions-widget";
import { WidgetMessage } from "@/components/dashboard/widgets/widget-messages";
import type { WidgetConfig } from "@/lib/widgets/config";
import type {
  ReadThroughWidgetType,
  SnapshotWidgetType,
  SourceOf,
  WirePayload,
} from "@/lib/widgets/snapshots";
import { lemonSqueezyRenderers } from "./lemonsqueezy";
import { netlifyRenderers } from "./netlify";
import { qontoRenderers } from "./qonto";
import { railwayRenderers } from "./railway";
import { resendRenderers } from "./resend";
import { sentryRenderers } from "./sentry";
import { statusBoardRenderers } from "./status-board";
import { stripeRenderers } from "./stripe";
import { supabaseRenderers } from "./supabase";
import type { SnapshotRenderer } from "./types";
import { vercelRenderers } from "./vercel";

/**
 * Every widget type, and what draws it.
 *
 * Two tables that between them cover `WidgetType` exactly: snapshot widgets,
 * drawn from the payload their source's poll loop shares, and read-through
 * widgets, which fetch for themselves. Both are total over their half, so a
 * new widget type does not compile until it has a renderer — the check the
 * old `switch` made in its `default:` branch, now made per entry and with the
 * payload typed for the source the type belongs to.
 */

export type SnapshotRenderers = {
  [T in SnapshotWidgetType]: SnapshotRenderer<SourceOf<T>>;
};

export const SNAPSHOT_RENDERERS: SnapshotRenderers = {
  ...railwayRenderers,
  ...netlifyRenderers,
  ...supabaseRenderers,
  ...qontoRenderers,
  ...stripeRenderers,
  ...lemonSqueezyRenderers,
  ...sentryRenderers,
  ...resendRenderers,
  ...vercelRenderers,
  ...statusBoardRenderers,
};

export type ReadThroughWidgetProps = {
  connectionId?: string | null;
  config: WidgetConfig;
};

function QontoTransactions({ connectionId, config }: ReadThroughWidgetProps) {
  return (
    <QontoTransactionsWidget connectionId={connectionId} limit={config.limit} />
  );
}

export const READ_THROUGH_WIDGETS: Record<
  ReadThroughWidgetType,
  ComponentType<ReadThroughWidgetProps>
> = {
  "qonto-transactions": QontoTransactions,
};

/**
 * Draw a snapshot widget from a payload as it came off the wire.
 *
 * This is the one place untyped JSON meets a typed renderer, and it is a cast
 * on purpose. TypeScript cannot follow the correlation between a `type` and
 * the snapshot its entry expects once `type` is a union, so some cast is
 * unavoidable; the question is only where. Here, the pairing is sound by
 * construction: the store polls one payload per source (`providerFor`), the
 * server fills it from `fetchDashboardSnapshot`, which is typed to return that
 * source's snapshot, and `SourceOf` pins each entry above to the same source.
 * Checking the shape again on every poll would buy nothing the write side does
 * not already guarantee — and what it does not guarantee, that a field is
 * present at all, is what `ServedSnapshot` leaves `Partial`.
 */
export function renderSnapshotWidget(
  type: SnapshotWidgetType,
  payload: WirePayload,
): ReactNode {
  // A dashboard row can outlive its widget type, so `type` is only as good as
  // the database it came from. Say so plainly rather than leave a blank card.
  if (!Object.prototype.hasOwnProperty.call(SNAPSHOT_RENDERERS, type)) {
    return (
      <WidgetMessage title="This widget is no longer available. Remove it from the dashboard in edit mode." />
    );
  }
  const render = SNAPSHOT_RENDERERS[type] as (data: WirePayload) => ReactNode;
  return render(payload);
}
