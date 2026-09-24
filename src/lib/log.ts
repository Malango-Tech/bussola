/**
 * Logging, in one shape everywhere.
 *
 * Production writes one JSON object per line — what every log platform
 * (Railway, Vercel, Datadog, Loki) parses without configuration, and what
 * makes "every sync failure for this connection" a query instead of a grep.
 * Development writes the same fields as a readable line.
 *
 * No dependency on purpose: a logger is the last thing that should fail to
 * load, and the few features needed here (levels, scoped fields, error
 * serialisation) fit on one screen.
 *
 *   const log = logger("sync");
 *   log.warn("connection disabled", { connectionId, failures });
 *   log.error("fetch failed", { connectionId }, error);
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = process.env.BUSSOLA_LOG_LEVEL as LogLevel | undefined;
  if (configured && configured in LEVELS) return LEVELS[configured];
  // Tests stay quiet unless they ask otherwise; everything else logs from info.
  return process.env.VITEST ? LEVELS.warn : LEVELS.info;
}

function jsonFormat(): boolean {
  const format = process.env.BUSSOLA_LOG_FORMAT;
  if (format === "json") return true;
  if (format === "pretty") return false;
  return process.env.NODE_ENV === "production";
}

/** Errors do not survive JSON.stringify; this keeps what is worth reading. */
export function serializeError(error: unknown): LogFields | undefined {
  if (error === undefined) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(error.cause !== undefined ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return { message: String(error) };
}

/**
 * Where error-level entries are additionally sent, if anywhere.
 *
 * Unset by default. A deployment that wants Sentry (or anything else) calls
 * `setErrorReporter` once at startup, and every `log.error` reaches it without
 * the call sites knowing.
 */
type ErrorReporter = (entry: {
  scope: string;
  message: string;
  fields: LogFields;
  error?: unknown;
}) => void;

let reporter: ErrorReporter | undefined;

export function setErrorReporter(next: ErrorReporter | undefined): void {
  reporter = next;
}

function write(
  level: LogLevel,
  scope: string,
  message: string,
  fields: LogFields,
  error?: unknown,
): void {
  if (LEVELS[level] < threshold()) return;

  const err = serializeError(error);
  const sink =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;

  if (jsonFormat()) {
    sink(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        scope,
        msg: message,
        ...fields,
        ...(err ? { err } : {}),
      }),
    );
  } else {
    const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
    sink(`[${scope}] ${message}${extra}`, ...(error !== undefined ? [error] : []));
  }

  if (level === "error" && reporter) {
    try {
      reporter({ scope, message, fields, error });
    } catch {
      // A broken reporter must never take the caller down with it.
    }
  }
}

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields, error?: unknown): void;
  error(message: string, fields?: LogFields, error?: unknown): void;
  /** A logger that adds `fields` to every entry, e.g. a connection id. */
  child(fields: LogFields): Logger;
};

export function logger(scope: string, base: LogFields = {}): Logger {
  return {
    debug: (message, fields = {}) =>
      write("debug", scope, message, { ...base, ...fields }),
    info: (message, fields = {}) =>
      write("info", scope, message, { ...base, ...fields }),
    warn: (message, fields = {}, error) =>
      write("warn", scope, message, { ...base, ...fields }, error),
    error: (message, fields = {}, error) =>
      write("error", scope, message, { ...base, ...fields }, error),
    child: (fields) => logger(scope, { ...base, ...fields }),
  };
}
