import { renderMrr, renderPayments, renderRevenue30d } from "./payments";
import type { RenderersFor } from "./types";

export const stripeRenderers: RenderersFor<"stripe"> = {
  "stripe-mrr": (data) => renderMrr(data.revenue),
  "stripe-revenue": (data) =>
    renderRevenue30d({
      volume: data.volume30d,
      revenue: data.revenue,
      fallbackCurrency: "eur",
      empty: "No payments in the last 30 days.",
    }),
  "stripe-payments": (data) => renderPayments(data.payments),
};
