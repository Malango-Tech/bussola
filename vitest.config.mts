import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // PGlite bootstraps a Postgres image on first use; the tenant suite needs
    // more than the default per-hook budget on a cold run.
    hookTimeout: 60_000,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/components/ui/**"],
      reporter: ["text-summary", "html"],
    },
  },
});
