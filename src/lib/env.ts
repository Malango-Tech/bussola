import path from "path";
import { z } from "zod";

/**
 * Configuration, read from the environment in one place.
 *
 * Every variable Bussola understands is declared below with its type, its
 * default and what counts as valid, so a typo in a deployment is an error
 * naming the variable at startup rather than a `NaN` pool size or a silently
 * ignored flag discovered in production. `.env.example` documents the same
 * list for people; this is the list for the code.
 *
 * Read lazily, on every call. Nothing here is captured at import time, so a
 * test that changes `process.env` between cases sees the change on its next
 * read — and so does a module that happens to be imported before the
 * environment is loaded. The parse is memoised on the raw values, which keeps
 * a hot path (a per-request header check) from re-validating an unchanged
 * environment.
 *
 * Variables owned by the platform rather than by Bussola — `NODE_ENV`,
 * `NEXT_RUNTIME`, `VITEST` — are read where they are used, as before. So are
 * the logger's two, by `lib/log` itself: a logger must never throw, so it
 * tolerates a bad value where `env()` would refuse one. They are declared
 * here all the same, which is what gets a typo in them reported at boot.
 */

/** `.env.example` ships every key blank, so an empty value means unset. */
const blank = (value: unknown) => (value === "" ? undefined : value);

const text = () => z.preprocess(blank, z.string().optional());

const httpUrl = () =>
  z.preprocess(
    blank,
    z
      .url({ protocol: /^https?$/, error: "must be an http(s) URL" })
      .optional(),
  );

const positiveInt = (fallback: number) =>
  z.preprocess(
    blank,
    z.coerce
      .number({ error: "must be a number" })
      .int({ error: "must be a whole number" })
      .positive({ error: "must be greater than zero" })
      .default(fallback),
  );

const positiveNumber = (fallback: number) =>
  z.preprocess(
    blank,
    z.coerce
      .number({ error: "must be a number" })
      .positive({ error: "must be greater than zero" })
      .default(fallback),
  );

/** A switch: `1`/`true` on, `0`/`false` or unset off, anything else an error. */
const flag = () =>
  z
    .preprocess(
      (value) => (typeof value === "string" ? blank(value.toLowerCase()) : value),
      z.enum(["0", "1", "true", "false"], { error: "must be 1 or 0" }).optional(),
    )
    .transform((value) => value === "1" || value === "true");

export type Edition = "self-hosted" | "cloud";

const shape = {
  // ─── Edition ───────────────────────────────────────────────────────────────
  /**
   * Anything but `cloud` is self-hosted, deliberately: the permissive edition
   * is the safe default for a value someone mistyped on their own machine,
   * while `cloud` is only ever set on purpose.
   */
  BUSSOLA_EDITION: z
    .preprocess(blank, z.string().optional())
    .transform((value): Edition => (value === "cloud" ? "cloud" : "self-hosted")),

  // ─── Database ──────────────────────────────────────────────────────────────
  /**
   * Not validated as a URL: libpq accepts socket paths and other forms a URL
   * parser rejects, and the driver's own error names the problem precisely.
   */
  DATABASE_URL: text(),
  DATABASE_POOL_MAX: positiveInt(10),
  BUSSOLA_DATA_DIR: text(),

  // ─── Auth ──────────────────────────────────────────────────────────────────
  BETTER_AUTH_SECRET: text(),
  BETTER_AUTH_URL: httpUrl(),
  BUSSOLA_PUBLIC_URL: httpUrl(),

  // ─── Secrets ───────────────────────────────────────────────────────────────
  /** 64 hex chars is the key itself; anything else is a passphrase. */
  BUSSOLA_ENCRYPTION_KEY: text(),

  // ─── Sync worker ───────────────────────────────────────────────────────────
  BUSSOLA_DISABLE_INLINE_SYNC: flag(),
  BUSSOLA_SYNC_SECRET: text(),
  BUSSOLA_SYNC_TICK_SECONDS: positiveNumber(15),
  BUSSOLA_SYNC_BATCH: positiveInt(25),

  // ─── HTTP ──────────────────────────────────────────────────────────────────
  /** Proxies in front of the app, for reading the caller's address. */
  BUSSOLA_TRUSTED_PROXY_HOPS: positiveInt(1),

  // ─── Logging ───────────────────────────────────────────────────────────────
  BUSSOLA_LOG_LEVEL: z.preprocess(
    blank,
    z
      .enum(["debug", "info", "warn", "error"], {
        error: "must be debug, info, warn or error",
      })
      .optional(),
  ),
  BUSSOLA_LOG_FORMAT: z.preprocess(
    blank,
    z.enum(["json", "pretty"], { error: "must be json or pretty" }).optional(),
  ),

  // ─── Email ─────────────────────────────────────────────────────────────────
  BUSSOLA_EMAIL_FROM: text(),
  BUSSOLA_RESEND_API_KEY: text(),
  BUSSOLA_POSTMARK_TOKEN: text(),

  // ─── Billing ───────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: text(),
  STRIPE_WEBHOOK_SECRET: text(),
  STRIPE_PRICE_SOLO_MONTHLY: text(),
  STRIPE_PRICE_SOLO_YEARLY: text(),
  STRIPE_PRICE_TEAM_MONTHLY: text(),
  STRIPE_PRICE_TEAM_YEARLY: text(),
  STRIPE_PRICE_TEAM_SEAT: text(),
};

/**
 * What the hosted edition refuses to start without.
 *
 * Each has a local-dev fallback that is fine on a laptop and unsafe for a
 * service holding other people's credentials: PGlite is single-process, a
 * generated encryption key and session secret live on one container's disk,
 * and without a pinned origin request origins are inferred rather than
 * checked.
 */
export const CLOUD_REQUIRED = [
  "DATABASE_URL",
  "BUSSOLA_ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const satisfies ReadonlyArray<keyof typeof shape>;

const schema = z.object(shape);

export type Env = z.output<typeof schema>;
export type EnvVariable = keyof typeof shape;

/** The Stripe price variables, which billing looks up by plan. */
export type StripePriceVariable = Extract<EnvVariable, `STRIPE_PRICE_${string}`>;

/** Anything shaped like `process.env`, for validating one that is not. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const VARIABLES = Object.keys(shape) as EnvVariable[];

const CLOUD_MISSING = "is required when BUSSOLA_EDITION=cloud";

/** The environment failed validation. `problems` has one entry per variable. */
export class EnvError extends Error {
  constructor(readonly problems: Array<{ variable: string; message: string }>) {
    super(describe(problems));
    this.name = "EnvError";
  }
}

function describe(problems: Array<{ variable: string; message: string }>) {
  const missing = problems
    .filter((problem) => problem.message === CLOUD_MISSING)
    .map((problem) => problem.variable);
  const invalid = problems.filter((problem) => problem.message !== CLOUD_MISSING);

  const lines: string[] = [];
  if (missing.length) {
    lines.push(
      `BUSSOLA_EDITION=cloud requires ${missing.join(", ")}. ` +
        "Refusing to start: the local-dev fallbacks are not safe for hosted use.",
    );
  }
  if (invalid.length) {
    lines.push(
      `Invalid configuration: ${invalid
        .map((problem) => `${problem.variable} ${problem.message}`)
        .join("; ")}.`,
    );
  }
  return lines.join(" ");
}

/**
 * Validate an environment, reporting every problem at once.
 *
 * Exposed with an explicit source for tests; the app calls `env()`.
 */
export function parseEnv(source: EnvSource = process.env): Env {
  const result = schema.safeParse(source);
  const problems = result.success
    ? []
    : result.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? "environment"),
        message: issue.message,
      }));

  if (edition(source) === "cloud") {
    // Checked on the raw values, so what is missing is reported alongside
    // what is malformed and a first cloud deploy is fixed in one round.
    for (const variable of CLOUD_REQUIRED) {
      if (blank(source[variable]) === undefined) {
        problems.push({ variable, message: CLOUD_MISSING });
      }
    }
  }

  if (!result.success || problems.length > 0) throw new EnvError(problems);
  return result.data;
}

let memo: { key: string; value: Env } | undefined;

/**
 * The validated configuration, as the environment stands right now.
 *
 * Throws `EnvError` if anything is invalid — for the hosted edition that
 * includes anything in `CLOUD_REQUIRED` being unset.
 */
export function env(): Env {
  // U+0001 marks "unset" so it cannot collide with an empty string.
  const key = VARIABLES.map((name) => process.env[name] ?? "\u0001").join("\u0000");
  if (memo?.key === key) return memo.value;
  const value = parseEnv(process.env);
  memo = { key, value };
  return value;
}

/**
 * The edition alone, without validating anything else.
 *
 * `lib/edition` resolves this once at import time, which must not fail just
 * because some unrelated variable is malformed: the full check belongs at
 * startup (`assertEditionConfig`), where it can refuse to boot with a message.
 */
export function edition(source: EnvSource = process.env): Edition {
  return shape.BUSSOLA_EDITION.parse(source.BUSSOLA_EDITION);
}

/**
 * Where local state lives: PGlite's data, and the generated session secret
 * and encryption key when none is configured.
 */
export function dataDir(): string {
  return env().BUSSOLA_DATA_DIR ?? path.join(process.cwd(), "data");
}
