import { and, eq, gt, isNull, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { apiTokens, member, type ApiTokenScope } from "@/lib/db/schema";
import { forTenant, type TenantRepos } from "@/lib/db/tenant";
import { hashToken, looksLikeToken } from "@/lib/sharing/tokens";

/**
 * Turning a bearer token into a tenant, for the MCP server.
 *
 * The third way into tenant data, alongside a session cookie and a share
 * token, and shaped like both: it produces the same organization-scoped
 * repositories, so an agent reaching Bussola over MCP is subject to exactly
 * the isolation a browser is. The token chooses the organization and the
 * scope; it can never widen what is visible inside it.
 */
export type McpPrincipal = {
  tokenId: string;
  organizationId: string;
  scope: ApiTokenScope;
  repos: TenantRepos;
};

/**
 * A token acts for the organization, not for a person.
 *
 * The minting user is recorded on the token row so access can be revoked with
 * them, but anything the agent creates is stamped with this rather than a real
 * user id — attributing an agent's dashboard to a human who did not make it
 * would be worse than attributing it to nobody.
 */
const AGENT_ACTOR = "mcp-agent";

export async function resolveApiToken(
  token: string | null,
): Promise<McpPrincipal | null> {
  if (!token || !looksLikeToken(token)) return null;

  const db = await getDb();

  const [row] = await db
    .select({
      id: apiTokens.id,
      organizationId: apiTokens.organizationId,
      scope: apiTokens.scope,
    })
    .from(apiTokens)
    // A token outlives nothing about the person who minted it: once they are
    // no longer a member, it stops working even if revoking it was missed.
    .innerJoin(
      member,
      and(
        eq(member.userId, apiTokens.userId),
        eq(member.organizationId, apiTokens.organizationId),
      ),
    )
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(token)),
        isNull(apiTokens.revokedAt),
        // An unset expiry means "until revoked".
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Not awaited: "last used" is diagnostic, and making every tool call wait on
  // a write to record that it happened is a poor trade.
  void touch(row.id);

  return {
    tokenId: row.id,
    organizationId: row.organizationId,
    scope: row.scope,
    repos: forTenant({
      organizationId: row.organizationId,
      userId: AGENT_ACTOR,
    }),
  };
}

async function touch(tokenId: string): Promise<void> {
  try {
    const db = await getDb();
    await db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, tokenId));
  } catch {
    // Never worth failing a tool call over.
  }
}

/** `Authorization: Bearer <token>`, or nothing. */
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}
