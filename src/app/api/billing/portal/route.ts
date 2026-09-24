import { jsonError, jsonOk, ROLE_FOR, withTenant } from "@/lib/api";
import { getSession } from "@/lib/auth/tenant";
import { appUrl, billingConfigured, getStripe } from "@/lib/billing/stripe";
import { ensureCustomer } from "@/lib/billing/subscription";

export const runtime = "nodejs";

/**
 * Hand the customer to Stripe's own portal for payment methods, invoices and
 * cancellation, rather than rebuilding any of that here.
 */
export async function POST() {
  return withTenant(async (repos) => {
    if (!billingConfigured()) {
      return jsonError("Billing is not enabled on this deployment", 404);
    }

    const session = await getSession();
    if (!session) return jsonError("Unauthorized", 401);

    const stripe = getStripe();
    const customer = await ensureCustomer(stripe, {
      organizationId: repos.ctx.organizationId,
      email: session.user.email,
      name: session.user.name,
    });

    const portal = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${appUrl()}/settings`,
    });

    return jsonOk({ url: portal.url });
  }, { role: ROLE_FOR.manageBilling });
}
