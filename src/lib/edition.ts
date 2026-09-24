import { edition, env, type Edition } from "@/lib/env";

/**
 * Bussola ships as one codebase in two editions.
 *
 * `self-hosted` (the default) is single-tenant: one organization is created on
 * first run and every request resolves to it. `cloud` is multi-tenant, with
 * signup, organizations and billing on top.
 *
 * The distinction exists only at the edges — configuration, entitlements and
 * identity resolution. Every query below `lib/db` is tenant-scoped in both
 * editions, so the self-hosted path exercises the same isolation code that
 * keeps cloud customers apart.
 */
export type { Edition };

export const EDITION: Edition = edition();

export const isCloud = EDITION === "cloud";
export const isSelfHosted = !isCloud;

/**
 * Fail fast on a deployment whose configuration is wrong.
 *
 * Validates the whole environment (`lib/env`), which for a cloud deployment
 * includes refusing to run without the configuration that keeps customer
 * credentials safe. Self-hosted installs stay permissive about what is unset
 * so that `npm run dev` works with no environment at all — but a value that
 * is set and malformed is an error in either edition.
 */
export function assertEditionConfig(): void {
  env();
}
