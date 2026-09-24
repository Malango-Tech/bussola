import { z } from "zod";
import { jsonError, jsonOk, ROLE_FOR, withTenant } from "@/lib/api";
import { getSession } from "@/lib/auth/tenant";
import { isPlanId, priceIdFor, type BillingInterval } from "@/lib/billing/plans";
import { appUrl, billingConfigured, getStripe } from "@/lib/billing/stripe";
import { ensureCustomer } from "@/lib/billing/subscription";

export const runtime = "nodejs";

const schema = z.object({
  plan: z.string(),
  interval: z.enum(["monthly", "yearly"]).default("monthly"),
});

export async function POST(request: Request) {
  return withTenant(async (repos) => {
    if (!billingConfigured()) {
      return jsonError("Billing is not enabled on this deployment", 404);
    }

    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success || !isPlanId(parsed.data.plan)) {
      return jsonError("Unknown plan");
    }

    const interval: BillingInterval = parsed.data.interval;
    const price = priceIdFor(parsed.data.plan, interval);
    if (!price) {
      return jsonError("That plan is not for sale right now", 400);
    }

    const session = await getSession();
    if (!session) return jsonError("Unauthorized", 401);

    const stripe = getStripe();
    const customer = await ensureCustomer(stripe, {
      organizationId: repos.ctx.organizationId,
      email: session.user.email,
      name: session.user.name,
    });

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: 1 }],
      success_url: `${appUrl()}/settings?checkout=success`,
      cancel_url: `${appUrl()}/settings?checkout=cancelled`,
      // Lets Stripe reconcile even if the customer object is ever recreated.
      subscription_data: {
        metadata: { organizationId: repos.ctx.organizationId },
      },
      allow_promotion_codes: true,
    });

    return jsonOk({ url: checkout.url });
  }, { role: ROLE_FOR.manageBilling });
}
