/**
 * Next runs this once per server process.
 *
 * Two jobs, both self-hosted only.
 *
 * Migrations: a single-server install should just work after `npm run dev`.
 * Making someone run a migration command first — and getting "relation does
 * not exist" when they don't — is a bad first five minutes for a product whose
 * pitch is plug-and-play. Cloud keeps migrations an explicit deploy step,
 * because several instances racing to migrate is its own failure mode.
 *
 * Sync: a self-hosted install is one long-running server, so it hosts the
 * scheduler itself and needs no second process. Cloud is replicated and/or
 * serverless, where an in-process loop would run once per instance and fight
 * over the queue — there the worker runs standalone (`npm run worker`) or on a
 * cron hitting /api/internal/sync.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { isSelfHosted } = await import("./lib/edition");
  if (!isSelfHosted) return;

  try {
    const { runMigrations } = await import("./lib/db");
    await runMigrations();
  } catch (error) {
    console.error(
      "[bussola] migrations failed — the app will not work until this is fixed:",
      error,
    );
    return;
  }

  try {
    const { reencryptLegacySecrets } = await import("./lib/crypto/rotate");
    await reencryptLegacySecrets();
  } catch (error) {
    // Legacy rows still decrypt, so a failed rotation is worth a log line,
    // not a server that refuses to start.
    console.error("[bussola] re-encrypting stored secrets failed:", error);
  }

  if (process.env.BUSSOLA_DISABLE_INLINE_SYNC === "1") return;

  const { startScheduler } = await import("./lib/sync/scheduler");
  startScheduler();
}
