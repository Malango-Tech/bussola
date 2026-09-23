import { z } from "zod";
import { jsonError, jsonOk, ROLE_FOR, withTenant } from "@/lib/api";
import { validateChannelTarget } from "@/lib/alerts/deliver";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { encryptSecret } from "@/lib/crypto/vault";
import { emailConfigured, EMAIL_SETUP_HINT } from "@/lib/notify/email";

export const runtime = "nodejs";

const KINDS = ["email", "slack", "discord"] as const;

/**
 * Where a channel delivers is never sent back to the browser.
 *
 * A webhook URL is a bearer credential — anyone holding it can post into the
 * channel — so it follows the same rule as a connector token: write-only, with
 * a hint for recognising which one a row is.
 */
function toDto(row: {
  id: string;
  kind: string;
  label: string;
  enabled: boolean;
  lastError: string | null;
  lastDeliveredAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    enabled: row.enabled,
    lastError: row.lastError,
    lastDeliveredAt: row.lastDeliveredAt,
    createdAt: row.createdAt,
  };
}

export async function GET() {
  return withTenant(async (repos) => {
    const entitlements = await entitlementsFor(repos.ctx.organizationId);
    return jsonOk({
      channels: (await repos.channels.list()).map(toDto),
      allowedKinds: entitlements.features.alertChannels,
      planName: entitlements.planName,
      // Email needs server configuration that no plan can grant, so the UI has
      // to be able to tell "your plan does not include this" apart from "this
      // install has no mail provider".
      emailConfigured: emailConfigured(),
      emailSetupHint: EMAIL_SETUP_HINT,
    });
  });
}

const createSchema = z.object({
  kind: z.enum(KINDS),
  label: z.string().min(1).max(80),
  target: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  return withTenant(async (repos) => {
    const body = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid channel payload");

    const entitlements = await entitlementsFor(repos.ctx.organizationId);
    if (!entitlements.features.alertChannels.includes(parsed.data.kind)) {
      return jsonError(
        `${parsed.data.kind} alerts are not part of the ${entitlements.planName} plan.`,
        402,
      );
    }

    // Checked here, at save time, rather than at fire time: a typo caught now
    // is a form error, while the same typo caught later is a missed alert.
    const valid = validateChannelTarget(parsed.data.kind, parsed.data.target);
    if (!valid.ok) return jsonError(valid.error);

    const channel = await repos.channels.create({
      kind: parsed.data.kind,
      label: parsed.data.label.trim(),
      targetEncrypted: encryptSecret(parsed.data.target.trim()),
    });

    return jsonOk({ channel: toDto(channel) }, { status: 201 });
  }, { role: ROLE_FOR.manageChannels });
}

const updateSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80).optional(),
  target: z.string().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  return withTenant(async (repos) => {
    const body = await request.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid channel payload");

    const existing = await repos.channels.get(parsed.data.id);
    if (!existing) return jsonError("Channel not found", 404);

    if (parsed.data.target) {
      const valid = validateChannelTarget(existing.kind, parsed.data.target);
      if (!valid.ok) return jsonError(valid.error);
    }

    const channel = await repos.channels.update(parsed.data.id, {
      label: parsed.data.label?.trim(),
      targetEncrypted: parsed.data.target
        ? encryptSecret(parsed.data.target.trim())
        : undefined,
      enabled: parsed.data.enabled,
    });
    if (!channel) return jsonError("Channel not found", 404);

    return jsonOk({ channel: toDto(channel) });
  }, { role: ROLE_FOR.manageChannels });
}

export async function DELETE(request: Request) {
  return withTenant(async (repos) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return jsonError("id required");

    const removed = await repos.channels.remove(id);
    if (!removed) return jsonError("Channel not found", 404);
    return jsonOk({ ok: true });
  }, { role: ROLE_FOR.manageChannels });
}
