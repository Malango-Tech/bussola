import { demoDashboard, demoStatusBoard } from "@/lib/demo/fixtures";
import type { Provider } from "@/lib/providers";
import type { WirePayload } from "./snapshots";

/**
 * The payload an unconnected source is served: its sample dashboard, marked.
 *
 * `_demo` is what makes it unmistakable — the frame labels it and links to
 * Connections, so nobody reads these as their own figures. `provider` names
 * the source for that label. Null when a provider has no fixtures, which the
 * caller turns into a plain "connect this" state.
 *
 * Its own module, rather than inline in `serve.ts`, so the widget tests render
 * exactly what an unconnected dashboard is sent, without pulling the database
 * layer into a browser test.
 */
export function demoPayload(provider: Provider | "multi"): WirePayload | null {
  const demo =
    provider === "multi" ? demoStatusBoard() : demoDashboard(provider);
  return demo ? { ...demo, _demo: true, provider } : null;
}
