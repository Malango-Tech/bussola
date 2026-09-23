import { closeDb, databaseUrl, runMigrations } from "../lib/db";
import { reencryptLegacySecrets } from "../lib/crypto/rotate";
import { EDITION } from "../lib/edition";

async function main() {
  const target = databaseUrl()
    ? new URL(databaseUrl()!).host
    : "PGlite (local file)";
  console.log(`Bussola · edition=${EDITION} · target=${target}`);

  await runMigrations();
  console.log("Migrations applied.");

  const rotation = await reencryptLegacySecrets();
  console.log(`Secrets re-encrypted: ${rotation.reencrypted}.`);

  await closeDb();
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
