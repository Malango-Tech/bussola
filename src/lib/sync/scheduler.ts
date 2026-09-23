import { drainDeliveries } from "@/lib/alerts/outbox";
import { logger } from "@/lib/log";
import { tickIntervalSeconds } from "./config";
import { pruneHistory } from "./retention";
import { runDueSyncs } from "./runner";

const log = logger("sync");

/** History retention is a slow-moving concern; once an hour is plenty. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A tick loop around `runDueSyncs`.
 *
 * Ticks never overlap: if a run is still going when the timer fires, the tick
 * is skipped rather than queued, so a slow provider cannot pile up runs. The
 * loop is deliberately dumb — the schedule lives in the database, so restarting
 * the process loses nothing.
 */
export type Scheduler = { stop: () => void };

let running: Scheduler | null = null;

export function startScheduler(
  { intervalSeconds = tickIntervalSeconds(), onReport = defaultReport } = {} as {
    intervalSeconds?: number;
    onReport?: (report: Awaited<ReturnType<typeof runDueSyncs>>) => void;
  },
): Scheduler {
  if (running) return running;

  let inFlight = false;
  let stopped = false;
  let lastPrune = 0;

  const tick = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      const report = await runDueSyncs();
      if (report.claimed > 0) onReport(report);

      /*
       * Alert notifications, after the syncs that may have queued them.
       *
       * Drained on the same tick rather than a timer of its own so there is
       * one loop to reason about — but *after* `runDueSyncs`, never inside it,
       * which is the whole point: a webhook that hangs for its full timeout
       * now delays the next tick's start, not a connection's schedule.
       */
      const drained = await drainDeliveries();
      if (drained.attempted > 0) {
        log.info("alerts drained", {
          sent: drained.sent,
          retrying: drained.failed,
          abandoned: drained.abandoned,
        });
      }

      if (Date.now() - lastPrune > PRUNE_INTERVAL_MS) {
        lastPrune = Date.now();
        const pruned = await pruneHistory();
        if (pruned.deleted > 0) {
          log.info("history pruned", {
            deleted: pruned.deleted,
            organizations: pruned.organizations,
          });
        }
      }
    } catch (error) {
      log.error("tick failed", {}, error);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(tick, intervalSeconds * 1000);
  // Never hold the process open just for the scheduler.
  timer.unref?.();

  // Log on start, not only when there is work: an operator needs to be able to
  // tell "nothing was due" apart from "the scheduler never came up".
  log.info("scheduler started", { tickSeconds: intervalSeconds });
  void tick();

  running = {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      running = null;
    },
  };
  return running;
}

function defaultReport(report: Awaited<ReturnType<typeof runDueSyncs>>) {
  log.info("tick", {
    claimed: report.claimed,
    ok: report.succeeded,
    failed: report.failed,
    ...(report.disabled > 0 ? { disabled: report.disabled } : {}),
  });
}
