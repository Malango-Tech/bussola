import { and, asc, count, desc, eq } from "drizzle-orm";
import { createId } from "@/lib/id";
import { getDb } from "..";
import { connections, type ConnectionStatus, type Provider } from "../schema";
import type { TenantContext } from "./context";

export function connectionsRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  const ownConnection = (id: string) =>
    and(eq(connections.id, id), eq(connections.organizationId, org));

  return {
    /**
     * Deliberately complete. Callers fan out over every connection — the
     * connections page, a cross-source widget's connection ids — and a
     * truncated list would read as a source quietly disconnecting. Each row
     * is also a provider account synced on a schedule, so the table cannot
     * grow without its owner noticing the work.
     */
    async list() {
      const db = await getDb();
      return db
        .select()
        .from(connections)
        .where(eq(connections.organizationId, org))
        .orderBy(desc(connections.updatedAt));
    },

    async get(id: string) {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(connections)
        .where(ownConnection(id))
        .limit(1);
      return row ?? null;
    },

    async count() {
      const db = await getDb();
      const [row] = await db
        .select({ value: count() })
        .from(connections)
        .where(eq(connections.organizationId, org));
      return row?.value ?? 0;
    },

    /**
     * The connection this tenant uses for a provider. Previously this read
     * the first matching row in the entire database, which in a multi-tenant
     * deployment would hand one customer another customer's credentials.
     */
    async byProvider(provider: Provider) {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.provider, provider),
            eq(connections.organizationId, org),
          ),
        )
        .orderBy(asc(connections.createdAt))
        .limit(1);
      return row ?? null;
    },

    /**
     * Every connection this tenant has for a provider, oldest first.
     *
     * The oldest is the default a widget with no explicit connection reads,
     * which is what keeps a canvas built before a second account was added
     * pointing at the same numbers it always did.
     */
    async listByProvider(provider: Provider) {
      const db = await getDb();
      return db
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.provider, provider),
            eq(connections.organizationId, org),
          ),
        )
        .orderBy(asc(connections.createdAt));
    },

    async create(input: {
      provider: Provider;
      label: string;
      credentialsEncrypted: string;
    }) {
      const db = await getDb();
      const [row] = await db
        .insert(connections)
        .values({
          id: createId("con"),
          organizationId: org,
          provider: input.provider,
          label: input.label,
          credentialsEncrypted: input.credentialsEncrypted,
          status: "unknown",
        })
        .returning();
      return row;
    },

    /**
     * Replacing credentials revives a connection whose sync had been
     * disabled after repeated failures: the whole point of pasting a new
     * token is that the old one was the problem.
     */
    async update(
      id: string,
      input: { label: string; credentialsEncrypted: string },
    ) {
      const db = await getDb();
      const [row] = await db
        .update(connections)
        .set({
          label: input.label,
          credentialsEncrypted: input.credentialsEncrypted,
          status: "unknown",
          lastError: null,
          syncEnabled: true,
          consecutiveFailures: 0,
          nextSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(ownConnection(id))
        .returning();
      return row ?? null;
    },

    async recordTest(
      id: string,
      result: { status: ConnectionStatus; error: string | null },
    ) {
      const db = await getDb();
      await db
        .update(connections)
        .set({
          status: result.status,
          lastError: result.error,
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(ownConnection(id));
    },

    async remove(id: string) {
      const db = await getDb();
      const rows = await db
        .delete(connections)
        .where(ownConnection(id))
        .returning({ id: connections.id });
      return rows.length > 0;
    },
  };
}
