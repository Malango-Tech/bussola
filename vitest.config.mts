import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Agent and editor worktrees live under .claude/ with their own copies of
    // every test; running those too would test other checkouts.
    exclude: [...configDefaults.exclude, ".claude/**"],
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
