import { z } from "zod";
import { jsonError, jsonOk, ROLE_FOR, withTenant } from "@/lib/api";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { mintToken } from "@/lib/sharing/tokens";

export const runtime = "nodejs";

/**
 * The fields a token row may show, picked rather than spread.
 *
 * `apiTokens.create` returns the whole row, hash included; spreading it here
 * once sent that hash back to the browser on every mint. Naming the fields
 * means a column added later stays server-side until someone decides
 * otherwise.
 */
function toDto(row: {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scope: row.scope,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

export async function GET() {
  return withTenant(async (repos) => {
    const entitlements = await entitlementsFor(repos.ctx.organizationId);
    return jsonOk({
      tokens: (await repos.apiTokens.list()).map(toDto),
      canUseMcp: entitlements.features.mcp,
      planName: entitlements.planName,
    });
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  scope: z.enum(["read", "write"]).default("read"),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export async function POST(request: Request) {
  return withTenant(async (repos) => {
    const body = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid token payload");

    const entitlements = await entitlementsFor(repos.ctx.organizationId);
    if (!entitlements.features.mcp) {
      return jsonError(
        `The MCP server is not part of the ${entitlements.planName} plan.`,
        402,
      );
    }

    const minted = mintToken("bsk");
    const token = await repos.apiTokens.create({
      name: parsed.data.name.trim(),
      tokenHash: minted.hash,
      tokenPrefix: minted.prefix,
      scope: parsed.data.scope,
      expiresAt: parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
        : null,
    });

    return jsonOk(
      {
        apiToken: toDto(token),
        // Shown once. Only the hash is stored, so a lost token has to be
        // revoked and replaced rather than looked up.
        token: minted.token,
      },
      { status: 201 },
    );
  }, { role: ROLE_FOR.manageTokens });
}

export async function DELETE(request: Request) {
  return withTenant(async (repos) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return jsonError("id required");

    const revoked = await repos.apiTokens.revoke(id);
    if (!revoked) return jsonError("Token not found or already revoked", 404);
    return jsonOk({ ok: true });
  }, { role: ROLE_FOR.manageTokens });
}
