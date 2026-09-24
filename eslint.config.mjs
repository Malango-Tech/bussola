import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The tenant boundary, enforced.
    //
    // Route handlers and pages must reach data through `requireTenant()` /
    // `withTenant()`, which hand back repositories already filtered by
    // organization. Importing the raw database or the table definitions here
    // would make it possible to write a query with no tenant filter, so it is
    // a lint error rather than a code-review convention.
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db",
              message:
                "Route handlers must not open the database directly. Use requireTenant()/withTenant() from @/lib/api so every query is organization-scoped.",
            },
            {
              name: "@/lib/db/schema",
              message:
                "Route handlers must not query tables directly. Use the scoped repositories from requireTenant()/withTenant(); import only types from @/lib/db/schema if you need them.",
            },
            {
              name: "drizzle-orm",
              message:
                "Query building belongs in src/lib/db/tenant.ts, where the organization filter is applied.",
            },
          ],
        },
      ],
    },
  },
  {
    // Auth and status endpoints legitimately need user/session tables, which
    // are keyed by user rather than organization.
    files: ["src/app/api/auth/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "drizzle/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
