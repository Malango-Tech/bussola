import { z } from "zod";
import { jsonError, jsonOk, ROLE_FOR, withTenant } from "@/lib/api";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { mintToken } from "@/lib/sharing/tokens";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Rows without the hash — the one column no caller has a use for. */
function toDto(row: {
  id: string;
  tokenPrefix: string;
  label: string | null;
  whiteLabel: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
  viewCount: number;
  lastViewedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    tokenPrefix: row.tokenPrefix,
    label: row.label,
    whiteLabel: row.whiteLabel,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt,
    createdAt: row.createdAt,
  };
}

export async function GET(_request: Request, { params }: Params) {
  return withTenant(async (repos) => {
    const { id: dashboardId } = await params;
    if (!(await repos.dashboards.get(dashboardId))) {
      return jsonError("Dashboard not found", 404);
    }

    const entitlements = await entitlementsFor(repos.ctx.organizationId);
    return jsonOk({
      shares: (await repos.shares.listFor(dashboardId)).map(toDto),
      canShare: entitlements.features.sharing,
      canWhiteLabel: entitlements.features.whiteLabelSharing,
      planName: entitlements.planName,
    });
  });
}

const createSchema = z.object({
  label: z.string().max(80).optional(),
  whiteLabel: z.boolean().optional(),
  /** Days until the link stops working. Absent means "until revoked". */
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export async function POST(request: Request, { params }: Params) {
  return withTenant(async (repos) => {
    const { id: dashboardId } = await params;
    if (!(await repos.dashboards.get(dashboardId))) {
      return jsonError("Dashboard not found", 404);
    }

    const body = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body ?? {});
    if (!parsed.success) return jsonError("Invalid share payload");

    const entitlements = await entitlementsFor(repos.ctx.organizationId);
    if (!entitlements.features.sharing) {
      // 402 rather than 403: the request is legitimate, the plan is the answer.
      return jsonError(
        `Read-only links are not part of the ${entitlements.planName} plan.`,
        402,
      );
    }

    // Asking for white-label on a plan without it downgrades the link rather
    // than refusing it — the link is what was wanted, the branding is a detail.
    const whiteLabel =
      Boolean(parsed.data.whiteLabel) && entitlements.features.whiteLabelSharing;

    const minted = mintToken("shr");
    const share = await repos.shares.create({
      dashboardId,
      tokenHash: minted.hash,
      tokenPrefix: minted.prefix,
      label: parsed.data.label?.trim() || null,
      whiteLabel,
      expiresAt: parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
        : null,
    });

    return jsonOk(
      {
        share: toDto(share),
        // The only time this is ever returned. It is not stored in a form
        // anything can read back, so a lost link must be revoked and remade.
        token: minted.token,
        downgraded: Boolean(parsed.data.whiteLabel) && !whiteLabel,
      },
      { status: 201 },
    );
  }, { role: ROLE_FOR.manageShares });
}

export async function DELETE(request: Request, { params }: Params) {
  return withTenant(async (repos) => {
    const { id: dashboardId } = await params;
    const { searchParams } = new URL(request.url);
    const shareId = searchParams.get("shareId");
    if (!shareId) return jsonError("shareId required");

    if (!(await repos.dashboards.get(dashboardId))) {
      return jsonError("Dashboard not found", 404);
    }

    const revoked = await repos.shares.revoke(shareId);
    if (!revoked) return jsonError("Link not found or already revoked", 404);
    return jsonOk({ ok: true, share: toDto(revoked) });
  }, { role: ROLE_FOR.manageShares });
}
