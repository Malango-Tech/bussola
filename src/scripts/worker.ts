import { closeDb, databaseUrl } from "../lib/db";
import { EDITION } from "../lib/edition";
import { tickIntervalSeconds } from "../lib/sync/config";
import { startScheduler } from "../lib/sync/scheduler";

/**
 * Standalone sync worker.
 *
 * Run this as its own process (a second container, a Railway service, a
 * systemd unit) when the app itself is serverless or replicated. Self-hosted
 * installs do not need it: the long-running Next server starts the same
 * scheduler in-process via instrumentation.ts.
 */
if (!databaseUrl()) {
  console.error(
    [
      "The standalone worker needs DATABASE_URL.",
      "",
      "With no DATABASE_URL the app stores data in PGlite, which serves a single",
      "process: a worker started alongside the app server would open the same",
      "directory a second time and act on a stale view of it. Either point both",
      "at a Postgres server, or drop this worker and let the self-hosted app run",
      "the scheduler in-process (it does so by default).",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `Bussola sync worker · edition=${EDITION} · tick=${tickIntervalSeconds()}s`,
);

const scheduler = startScheduler();

async function shutdown(signal: string) {
  console.log(`\n[sync] ${signal} — stopping`);
  scheduler.stop();
  await closeDb();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Hold the process open; the scheduler's own timer is unref'd.
setInterval(() => {}, 1 << 30);
