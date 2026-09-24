import { afterEach, describe, expect, it } from "vitest";
import {
  CLOUD_REQUIRED,
  EnvError,
  edition,
  env,
  parseEnv,
  type EnvSource,
} from "./env";

/**
 * The configuration contract: what is accepted, what each unset variable
 * falls back to, and that a mistake names the variable it is in.
 */
const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

const CLOUD_OK = {
  BUSSOLA_EDITION: "cloud",
  DATABASE_URL: "postgres://localhost/bussola",
  BUSSOLA_ENCRYPTION_KEY: "a".repeat(64),
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "https://app.example",
};

function problemsOf(source: EnvSource) {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  return [];
}

describe("parseEnv", () => {
  it("accepts an empty environment, with the documented defaults", () => {
    const parsed = parseEnv({});
    expect(parsed).toMatchObject({
      BUSSOLA_EDITION: "self-hosted",
      DATABASE_POOL_MAX: 10,
      BUSSOLA_SYNC_TICK_SECONDS: 15,
      BUSSOLA_SYNC_BATCH: 25,
      BUSSOLA_TRUSTED_PROXY_HOPS: 1,
      BUSSOLA_DISABLE_INLINE_SYNC: false,
    });
    expect(parsed.DATABASE_URL).toBeUndefined();
  });

  it("treats an empty value as unset, as .env.example ships them", () => {
    const parsed = parseEnv({
      DATABASE_URL: "",
      DATABASE_POOL_MAX: "",
      BETTER_AUTH_URL: "",
      BUSSOLA_DISABLE_INLINE_SYNC: "",
    });
    expect(parsed.DATABASE_URL).toBeUndefined();
    expect(parsed.DATABASE_POOL_MAX).toBe(10);
    expect(parsed.BETTER_AUTH_URL).toBeUndefined();
    expect(parsed.BUSSOLA_DISABLE_INLINE_SYNC).toBe(false);
  });

  it("coerces numbers and switches", () => {
    const parsed = parseEnv({
      DATABASE_POOL_MAX: "4",
      BUSSOLA_SYNC_TICK_SECONDS: "2.5",
      BUSSOLA_DISABLE_INLINE_SYNC: "1",
    });
    expect(parsed.DATABASE_POOL_MAX).toBe(4);
    expect(parsed.BUSSOLA_SYNC_TICK_SECONDS).toBe(2.5);
    expect(parsed.BUSSOLA_DISABLE_INLINE_SYNC).toBe(true);
    expect(parseEnv({ BUSSOLA_DISABLE_INLINE_SYNC: "TRUE" }).BUSSOLA_DISABLE_INLINE_SYNC).toBe(true);
    expect(parseEnv({ BUSSOLA_DISABLE_INLINE_SYNC: "0" }).BUSSOLA_DISABLE_INLINE_SYNC).toBe(false);
  });

  it("names every malformed variable in one error", () => {
    const problems = problemsOf({
      DATABASE_POOL_MAX: "ten",
      BUSSOLA_SYNC_BATCH: "2.5",
      BUSSOLA_TRUSTED_PROXY_HOPS: "0",
      BUSSOLA_DISABLE_INLINE_SYNC: "yes",
      BETTER_AUTH_URL: "app.example",
      BUSSOLA_LOG_LEVEL: "verbose",
    });
    expect(problems.map((problem) => problem.variable).sort()).toEqual([
      "BETTER_AUTH_URL",
      "BUSSOLA_DISABLE_INLINE_SYNC",
      "BUSSOLA_LOG_LEVEL",
      "BUSSOLA_SYNC_BATCH",
      "BUSSOLA_TRUSTED_PROXY_HOPS",
      "DATABASE_POOL_MAX",
    ]);
    expect(() => parseEnv({ DATABASE_POOL_MAX: "ten" })).toThrow(
      /DATABASE_POOL_MAX must be a number/,
    );
  });

  it("only accepts web URLs for the public origins", () => {
    expect(problemsOf({ BUSSOLA_PUBLIC_URL: "ftp://files.example" })).toHaveLength(1);
    expect(problemsOf({ BUSSOLA_PUBLIC_URL: "http://localhost:3000" })).toEqual([]);
  });

  it("does not second-guess a Postgres connection string", () => {
    // libpq accepts forms a URL parser would reject; the driver reports those.
    expect(parseEnv({ DATABASE_URL: "postgresql:///bussola?host=/var/run/postgresql" }).DATABASE_URL).toBe(
      "postgresql:///bussola?host=/var/run/postgresql",
    );
  });
});

describe("the hosted edition", () => {
  it("starts once everything it needs is set", () => {
    expect(parseEnv(CLOUD_OK).BUSSOLA_EDITION).toBe("cloud");
  });

  it.each(CLOUD_REQUIRED)("refuses to start without %s", (missing) => {
    expect(() => parseEnv({ ...CLOUD_OK, [missing]: "" })).toThrow(
      new RegExp(`BUSSOLA_EDITION=cloud requires ${missing}\\b`),
    );
  });

  it("reports what is missing and what is malformed together", () => {
    const problems = problemsOf({
      BUSSOLA_EDITION: "cloud",
      DATABASE_POOL_MAX: "many",
    });
    expect(problems.map((problem) => problem.variable).sort()).toEqual(
      [...CLOUD_REQUIRED, "DATABASE_POOL_MAX"].sort(),
    );
  });

  it("does not apply cloud requirements to a self-hosted install", () => {
    expect(problemsOf({ BUSSOLA_EDITION: "self-hosted" })).toEqual([]);
  });
});

describe("env()", () => {
  it("reads the environment as it is now, not as it was at import", () => {
    process.env.BUSSOLA_SYNC_BATCH = "5";
    expect(env().BUSSOLA_SYNC_BATCH).toBe(5);
    process.env.BUSSOLA_SYNC_BATCH = "7";
    expect(env().BUSSOLA_SYNC_BATCH).toBe(7);
    delete process.env.BUSSOLA_SYNC_BATCH;
    expect(env().BUSSOLA_SYNC_BATCH).toBe(25);
  });

  it("sees a replaced process.env object too", () => {
    process.env = { ...original, DATABASE_POOL_MAX: "3" };
    expect(env().DATABASE_POOL_MAX).toBe(3);
  });

  it("throws until a bad value is fixed", () => {
    process.env.BUSSOLA_SYNC_BATCH = "lots";
    expect(() => env()).toThrow(EnvError);
    process.env.BUSSOLA_SYNC_BATCH = "10";
    expect(env().BUSSOLA_SYNC_BATCH).toBe(10);
  });
});

describe("edition()", () => {
  it("reads only the edition, so an unrelated mistake cannot change it", () => {
    expect(edition({ BUSSOLA_EDITION: "cloud", DATABASE_POOL_MAX: "many" })).toBe("cloud");
    expect(edition({ BUSSOLA_EDITION: "staging" })).toBe("self-hosted");
    expect(edition({})).toBe("self-hosted");
  });
});
