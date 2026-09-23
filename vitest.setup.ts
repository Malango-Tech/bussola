import { afterEach } from "vitest";

/*
 * DOM helpers, only where there is a DOM.
 *
 * Most suites run in Node against PGlite and never render anything, so the
 * testing-library imports are skipped there rather than paid for in every
 * file. A component test opts into jsdom with a
 * `// @vitest-environment jsdom` comment at its top.
 */
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());
}
