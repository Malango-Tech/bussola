import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { createId } from "@/lib/id";
import { getDb } from "..";
import { apiTokens, type ApiTokenScope } from "../schema";
import type { TenantContext } from "./context";

/** Tokens listed per organization; see `list`. */
export const MAX_TOKENS_LISTED = 100;

export function apiTokensRepo(ctx: TenantContext) {
  const org = ctx.organizationId;

  return {
    /**
     * Never returns the hash: nothing in the UI has a use for it.
     *
     * Bounded like share links, and for the same reason: revoking keeps the
     * row, so the list only grows. Live tokens are chosen first so one that
     * still works can never be pushed out of sight by revoked ones, then the
     * page is returned newest first as before.
     */
    async list() {
      const db = await getDb();
      const rows = await db
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
        .orderBy(sql`${apiTokens.revokedAt} is null desc`, desc(apiTokens.createdAt))
        .limit(MAX_TOKENS_LISTED);
      return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
