import { drainDeliveries } from "@/lib/alerts/outbox";
import { tickIntervalSeconds } from "./config";
import { pruneHistory } from "./retention";
import { runDueSyncs } from "./runner";

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
        console.log(
          `[alerts] sent=${drained.sent} retrying=${drained.failed} abandoned=${drained.abandoned}`,
        );
      }

      if (Date.now() - lastPrune > PRUNE_INTERVAL_MS) {
        lastPrune = Date.now();
        const pruned = await pruneHistory();
        if (pruned.deleted > 0) {
          console.log(
            `[sync] pruned ${pruned.deleted} history rows across ${pruned.organizations} organizations`,
          );
        }
      }
    } catch (error) {
      console.error("[sync] tick failed:", error);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(tick, intervalSeconds * 1000);
  // Never hold the process open just for the scheduler.
  timer.unref?.();

  // Log on start, not only when there is work: an operator needs to be able to
  // tell "nothing was due" apart from "the scheduler never came up".
  console.log(`[sync] scheduler started · tick=${intervalSeconds}s`);
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
  const parts = [
    `claimed=${report.claimed}`,
    `ok=${report.succeeded}`,
    `failed=${report.failed}`,
  ];
  if (report.disabled > 0) parts.push(`disabled=${report.disabled}`);
  console.log(`[sync] ${parts.join(" ")}`);
}
