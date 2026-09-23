import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cloud edition must refuse to boot on the local-dev fallbacks: an unset
 * encryption key would make every tenant's provider tokens decryptable by
 * anyone holding the database.
 */
const CLOUD_REQUIRED = [
  "DATABASE_URL",
  "BUSSOLA_ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const;

async function loadEdition(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of ["BUSSOLA_EDITION", ...CLOUD_REQUIRED]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  return import("./edition");
}

const original = { ...process.env };
beforeEach(() => vi.resetModules());
afterEach(() => {
  process.env = { ...original };
});

describe("self-hosted", () => {
  it("is the default edition", async () => {
    const { EDITION, isSelfHosted } = await loadEdition({});
    expect(EDITION).toBe("self-hosted");
    expect(isSelfHosted).toBe(true);
  });

  it("starts with no configuration at all", async () => {
    const { assertEditionConfig } = await loadEdition({});
    expect(() => assertEditionConfig()).not.toThrow();
  });

  it("treats any unknown value as self-hosted", async () => {
    const { isCloud } = await loadEdition({ BUSSOLA_EDITION: "staging" });
    expect(isCloud).toBe(false);
  });
});

describe("cloud", () => {
  it("refuses to start when nothing is configured", async () => {
    const { assertEditionConfig } = await loadEdition({
      BUSSOLA_EDITION: "cloud",
    });
    expect(() => assertEditionConfig()).toThrow(/DATABASE_URL/);
  });

  it.each(CLOUD_REQUIRED)("refuses to start without %s", async (missing) => {
    const env: Record<string, string> = { BUSSOLA_EDITION: "cloud" };
    for (const key of CLOUD_REQUIRED) {
      // Valid values, so the only thing wrong is the one that is missing.
      if (key !== missing) env[key] = key === "BETTER_AUTH_URL" ? "https://app.example" : "set";
    }
    const { assertEditionConfig } = await loadEdition(env);
    expect(() => assertEditionConfig()).toThrow(missing);
  });

  it("starts once everything is configured", async () => {
    const { assertEditionConfig, isCloud } = await loadEdition({
      BUSSOLA_EDITION: "cloud",
      DATABASE_URL: "postgres://localhost/bussola",
      BUSSOLA_ENCRYPTION_KEY: "a".repeat(64),
      BETTER_AUTH_SECRET: "secret",
      BETTER_AUTH_URL: "https://app.example",
    });
    expect(isCloud).toBe(true);
    expect(() => assertEditionConfig()).not.toThrow();
  });
});

describe("either edition", () => {
  it("refuses a value that is set but malformed", async () => {
    const { assertEditionConfig } = await loadEdition({
      DATABASE_POOL_MAX: "plenty",
    });
    expect(() => assertEditionConfig()).toThrow(/DATABASE_POOL_MAX/);
  });
});
