import { closeDb, databaseUrl, runMigrations } from "../lib/db";
import { reencryptLegacySecrets } from "../lib/crypto/rotate";
import { EDITION } from "../lib/edition";
import { logger } from "../lib/log";

const log = logger("migrate");

async function main() {
  const url = databaseUrl();
  const target = url ? new URL(url).host : "PGlite (local file)";
  log.info("starting", { edition: EDITION, target });

  await runMigrations();
  log.info("migrations applied");

  const rotation = await reencryptLegacySecrets();
  log.info("secrets re-encrypted", { count: rotation.reencrypted });

  await closeDb();
}

main().catch((error) => {
  log.error("migration failed", {}, error);
  process.exitCode = 1;
});
