import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { connections, notificationChannels } from "@/lib/db/schema";
import { logger } from "@/lib/log";
import { decryptSecretDetailed, encryptSecret } from "./vault";

const log = logger("vault");

export type RotationReport = {
  reencrypted: number;
  /** Rows no known key opens: a changed or lost key, left untouched. */
  unreadable: number;
};

/**
 * Move every stored secret onto the current key.
 *
 * Runs at startup (self-hosted) and with `npm run db:migrate` (hosted). It is
 * what lets the vault stop trusting a legacy key over time: once every row has
 * been rewritten, nothing depends on the old derivation any more. Rows already
 * on the current key cost one decryption each and are not written.
 *
 * Deliberately across organizations: this is maintenance on the vault, not a
 * read of tenant data, and it never returns a plaintext.
 */
export async function reencryptLegacySecrets(): Promise<RotationReport> {
  const db = await getDb();
  const report: RotationReport = { reencrypted: 0, unreadable: 0 };

  const rotate = (
    value: string,
    row: { table: string; id: string },
  ): string | null => {
    try {
      const { plaintext, legacy } = decryptSecretDetailed(value);
      return legacy ? encryptSecret(plaintext) : null;
    } catch (error) {
      // Counted and summarised below; the per-row line says which ones.
      report.unreadable += 1;
      log.debug("stored secret could not be decrypted", {
        ...row,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  const connectionRows = await db
    .select({ id: connections.id, value: connections.credentialsEncrypted })
    .from(connections);
  for (const row of connectionRows) {
    const next = rotate(row.value, { table: "connections", id: row.id });
    if (!next) continue;
    await db
      .update(connections)
      .set({ credentialsEncrypted: next })
      .where(eq(connections.id, row.id));
    report.reencrypted += 1;
  }

  const channelRows = await db
    .select({
      id: notificationChannels.id,
      value: notificationChannels.targetEncrypted,
    })
    .from(notificationChannels);
  for (const row of channelRows) {
    const next = rotate(row.value, {
      table: "notification_channels",
      id: row.id,
    });
    if (!next) continue;
    await db
      .update(notificationChannels)
      .set({ targetEncrypted: next })
      .where(eq(notificationChannels.id, row.id));
    report.reencrypted += 1;
  }

  if (report.reencrypted > 0) {
    log.info("re-encrypted stored secrets with the current key", {
      count: report.reencrypted,
    });
  }
  if (report.unreadable > 0) {
    log.warn(
      "stored secrets could not be decrypted with any known key — was BUSSOLA_ENCRYPTION_KEY changed?",
      { count: report.unreadable },
    );
  }
  return report;
}
