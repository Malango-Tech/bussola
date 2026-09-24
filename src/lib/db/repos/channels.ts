import { and, asc, eq } from "drizzle-orm";
import { createId } from "@/lib/id";
import { getDb } from "..";
import { notificationChannels, type NotificationChannelKind } from "../schema";
import type { TenantContext } from "./context";

export function channelsRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  const ownChannel = (id: string) =>
    and(
      eq(notificationChannels.id, id),
      eq(notificationChannels.organizationId, org),
    );

  return {
    /**
     * Deliberately complete: the alert rule routes check ownership of a
     * rule's channels against this list, so a bound would start rejecting
     * real channels. Channels are a handful of destinations per organization.
     */
    async list() {
      const db = await getDb();
      return db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.organizationId, org))
        .orderBy(asc(notificationChannels.createdAt));
    },

    async get(id: string) {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(notificationChannels)
        .where(ownChannel(id))
        .limit(1);
      return row ?? null;
    },

    async create(input: {
      kind: NotificationChannelKind;
      label: string;
      targetEncrypted: string;
    }) {
      const db = await getDb();
      const [row] = await db
        .insert(notificationChannels)
        .values({
          id: createId("nch"),
          organizationId: org,
          kind: input.kind,
          label: input.label,
          targetEncrypted: input.targetEncrypted,
        })
        .returning();
      return row;
    },

    async update(
      id: string,
      input: {
        label?: string;
        targetEncrypted?: string;
        enabled?: boolean;
      },
    ) {
      const db = await getDb();
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.label !== undefined) patch.label = input.label;
      if (input.targetEncrypted !== undefined) {
        patch.targetEncrypted = input.targetEncrypted;
        // New target, clean slate: the stored error described the old one.
        patch.lastError = null;
      }
      if (input.enabled !== undefined) patch.enabled = input.enabled;

      const [row] = await db
        .update(notificationChannels)
        .set(patch)
        .where(ownChannel(id))
        .returning();
      return row ?? null;
    },

    /**
     * Stamp the outcome of a delivery attempt on the channel.
     *
     * Shared by the drainer and the test-send button, so a channel's status
     * means the same thing however it was last exercised.
     */
    async recordTest(
      id: string,
      result: { ok: boolean; error?: string },
    ) {
      const db = await getDb();
      await db
        .update(notificationChannels)
        .set(
          result.ok
            ? { lastDeliveredAt: new Date(), lastError: null }
            : { lastError: result.error ?? "Delivery failed" },
        )
        .where(ownChannel(id));
    },

    async remove(id: string) {
      const db = await getDb();
      const rows = await db
        .delete(notificationChannels)
        .where(ownChannel(id))
        .returning({ id: notificationChannels.id });
      return rows.length > 0;
    },
  };
}
