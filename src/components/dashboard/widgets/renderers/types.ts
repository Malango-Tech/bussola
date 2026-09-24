import type { ReactNode } from "react";
import type {
  ServedSnapshot,
  SnapshotSource,
  SnapshotWidgetType,
  SourceOf,
} from "@/lib/widgets/snapshots";

/**
 * Draws one widget from its source's snapshot.
 *
 * A plain function rather than a component: it runs inside the frame's render
 * and owns no state, so there is nothing a component boundary would buy, and
 * the frame decides what wraps it.
 */
export type SnapshotRenderer<S extends SnapshotSource> = (
  data: ServedSnapshot<S>,
) => ReactNode;

/**
 * Exactly the renderers one source's module must provide.
 *
 * Keyed by the widget types whose name puts them on that source, so the
 * Railway module is handed `ServedSnapshot<"railway">` for every `railway-*`
 * type and cannot declare a renderer for anything else.
 */
export type RenderersFor<S extends SnapshotSource> = {
  [T in SnapshotWidgetType as SourceOf<T> extends S ? T : never]: SnapshotRenderer<S>;
};
