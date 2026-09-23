import { render, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { WidgetRenderer } from "@/components/dashboard/widget-renderer";
import { demoTransactions } from "@/lib/demo/fixtures";
import { demoPayload } from "@/lib/widgets/demo";
import {
  getWidgetDefinition,
  type WidgetType,
} from "@/lib/widgets/registry";
import { isReadThroughType, type WirePayload } from "@/lib/widgets/snapshots";

/*
 * Shared plumbing for the widget render tests. Not a test file itself: the
 * `vi.mock` calls have to live in each test file (they are hoisted per file),
 * so this only holds what those mocks and tests call into.
 */

/**
 * What jsdom lacks and the widgets use: observers for sizing and infinite
 * scroll, and a non-zero height so the transactions widget decides how many
 * rows to fetch at all.
 */
export function stubLayout() {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("ResizeObserver", NoopObserver);
  vi.stubGlobal("IntersectionObserver", NoopObserver);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
}

/** The payload an unconnected dashboard is served for a widget type. */
export function servedDemo(type: WidgetType): WirePayload {
  if (isReadThroughType(type)) return { ...demoTransactions(), _demo: true };
  const provider = getWidgetDefinition(type)?.provider;
  const payload = provider ? demoPayload(provider) : null;
  if (!payload) throw new Error(`No demo payload for ${type}`);
  return payload;
}

/**
 * React numbers `useId` values per client root, so two renders of the same
 * tree differ only in those ids. They carry no content; strip them before
 * comparing markup.
 */
export function normalizeIds(html: string): string {
  return html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|\bbase-ui-[\w-]+/g, "«id»");
}

/**
 * Render one widget exactly as the frame would, from a given payload.
 *
 * Snapshot widgets read it through the (mocked) store, via `serve` — the
 * object each test file's `useWidgetData` mock returns. The read-through
 * widget fetches for itself, so it gets the payload from a stubbed `fetch`
 * and is awaited until it has drawn.
 */
export async function renderWidget(
  type: WidgetType,
  payload: WirePayload,
  serve: { data: WirePayload | null },
) {
  if (isReadThroughType(type)) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );
    const result = render(<WidgetRenderer type={type} />);
    await waitFor(() =>
      // Loaded once the skeleton is gone.
      expecting(result.container.querySelector('[aria-busy="true"]') === null),
    );
    return result;
  }
  serve.data = payload;
  return render(<WidgetRenderer type={type} />);
}

function expecting(condition: boolean) {
  if (!condition) throw new Error("not yet");
}
