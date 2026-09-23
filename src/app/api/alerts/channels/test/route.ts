import { z } from "zod";
import { jsonError, jsonOk, ROLE_FOR, withTenant } from "@/lib/api";
import { deliver } from "@/lib/alerts/deliver";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { decryptSecret } from "@/lib/crypto/vault";
import { rateLimit, rateLimitHeaders } from "@/lib/http/rate-limit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Send a real notification through one channel, and say what happened.
 *
 * The point is that a channel is otherwise only proven at the moment it
 * matters — the first time something actually breaks. A webhook URL with a
 * typo, an email provider whose key was never set, a Slack app removed from
 * the workspace: all three look identical to a working channel until an alert
 * fires and quietly goes nowhere.
 *
 * This is the one place the app deliberately sends on demand, so it is metered
 * per organization: a send button is an outbound-request button, and one that
 * anyone signed in can hold down is a way to make Bussola's egress somebody
 * else's problem.
 */
const TEST_LIMIT = { limit: 10, windowMs: 60_000 };

const schema = z.object({ id: z.string() });

export async function POST(request: Request) {
  return withTenant(async (repos) => {
    const limited = rateLimit(
      `channel-test:${repos.ctx.organizationId}`,
      TEST_LIMIT,
    );
    if (!limited.ok) {
      return NextResponse.json(
        { error: `Too many test sends. Try again in ${limited.retryAfter}s.` },
        { status: 429, headers: rateLimitHeaders(limited) },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid payload");

    const channel = await repos.channels.get(parsed.data.id);
    if (!channel) return jsonError("Channel not found", 404);

    const entitlements = await entitlementsFor(repos.ctx.organizationId);
    if (!entitlements.features.alertChannels.includes(channel.kind)) {
      return jsonError(
        `${channel.kind} alerts are not part of the ${entitlements.planName} plan.`,
        402,
      );
    }

    let target: string;
    try {
      target = decryptSecret(channel.targetEncrypted);
    } catch {
      return jsonError(
        "Could not decrypt this channel — re-enter its destination.",
      );
    }

    const result = await deliver(
      { id: channel.id, kind: channel.kind, label: channel.label, target },
      {
        state: "ok",
        source: `${channel.label} · test`,
        // Deliberately worded so nobody who receives it thinks something broke.
        message:
          "This is a test from Bussola. If you can read it, this channel works.",
      },
    );

    // Recorded on the channel like any other delivery, so a green tick in the
    // list means "this actually reached somewhere", not "this was saved".
    await repos.channels.recordTest(channel.id, result);

    return result.ok
      ? jsonOk({ ok: true })
      : jsonOk({ ok: false, error: result.error }, { status: 200 });
  }, { role: ROLE_FOR.manageChannels });
}
