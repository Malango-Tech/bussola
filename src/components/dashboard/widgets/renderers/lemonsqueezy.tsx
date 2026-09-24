import { renderMrr, renderPayments, renderRevenue30d } from "./payments";
import type { RenderersFor } from "./types";

export const lemonSqueezyRenderers: RenderersFor<"lemonsqueezy"> = {
  "lemonsqueezy-mrr": (data) => renderMrr(data.revenue),
  "lemonsqueezy-revenue": (data) =>
    renderRevenue30d({
      volume: data.revenue30d,
      revenue: data.revenue,
      fallbackCurrency: "usd",
      empty: "No store revenue yet.",
    }),
  // Lemon Squeezy calls them orders; they are the same rows as Stripe payments.
  "lemonsqueezy-orders": (data) => renderPayments(data.orders),
};
