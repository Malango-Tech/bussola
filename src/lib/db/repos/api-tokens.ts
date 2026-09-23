import { and, desc, eq, isNull } from "drizzle-orm";
import { createId } from "@/lib/id";
import { getDb } from "..";
import { apiTokens, type ApiTokenScope } from "../schema";
import type { TenantContext } from "./context";

export function apiTokensRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  return {
    /** Never returns the hash: nothing in the UI has a use for it. */
    async list() {
      const db = await getDb();
      return db
        .select({
          id: apiTokens.id,
          name: apiTokens.name,
          tokenPrefix: apiTokens.tokenPrefix,
          scope: apiTokens.scope,
          expiresAt: apiTokens.expiresAt,
          revokedAt: apiTokens.revokedAt,
          lastUsedAt: apiTokens.lastUsedAt,
          createdAt: apiTokens.createdAt,
        })
        .from(apiTokens)
        .where(eq(apiTokens.organizationId, org))
        .orderBy(desc(apiTokens.createdAt));
    },

    async create(input: {
      name: string;
      tokenHash: string;
      tokenPrefix: string;
      scope: ApiTokenScope;
      expiresAt: Date | null;
    }) {
      const db = await getDb();
      const [row] = await db
        .insert(apiTokens)
        .values({
          id: createId("tok"),
          organizationId: org,
          userId: ctx.userId,
          name: input.name,
          tokenHash: input.tokenHash,
          tokenPrefix: input.tokenPrefix,
          scope: input.scope,
          expiresAt: input.expiresAt,
        })
        .returning();
      return row;
    },

    async revoke(id: string) {
      const db = await getDb();
      const [row] = await db
        .update(apiTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiTokens.id, id),
            eq(apiTokens.organizationId, org),
            isNull(apiTokens.revokedAt),
          ),
        )
        .returning();
      return row ?? null;
    },
  };
}
