import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { connections, notificationChannels } from "@/lib/db/schema";
import { decryptSecretDetailed, encryptSecret } from "./vault";

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

  const rotate = (value: string): string | null => {
    try {
      const { plaintext, legacy } = decryptSecretDetailed(value);
      return legacy ? encryptSecret(plaintext) : null;
    } catch {
      report.unreadable += 1;
      return null;
    }
  };

  const connectionRows = await db
    .select({ id: connections.id, value: connections.credentialsEncrypted })
    .from(connections);
  for (const row of connectionRows) {
    const next = rotate(row.value);
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
    const next = rotate(row.value);
    if (!next) continue;
    await db
      .update(notificationChannels)
      .set({ targetEncrypted: next })
      .where(eq(notificationChannels.id, row.id));
    report.reencrypted += 1;
  }

  if (report.reencrypted > 0) {
    console.log(
      `[bussola] re-encrypted ${report.reencrypted} stored secret(s) with the current key`,
    );
  }
  if (report.unreadable > 0) {
    console.warn(
      `[bussola] ${report.unreadable} stored secret(s) could not be decrypted with any known key — was BUSSOLA_ENCRYPTION_KEY changed?`,
    );
  }
  return report;
}
