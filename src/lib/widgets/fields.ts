import type { WidgetType } from "./registry";

/**
 * The top-level payload fields each widget type reads.
 *
 * Every widget of a provider is served the same snapshot, which is what lets
 * the browser poll one request per provider. For the signed-in owner that is
 * harmless: they can see all of it anyway. A share link is different — it may
 * return only what its dashboard puts on screen, so the share route trims the
 * snapshot to the union of these fields over the widgets actually shared. A
 * link to a balance card then no longer carries the cashflow history, the
 * account list or anything else the same snapshot happens to hold.
 *
 * `Record` rather than `Partial<Record>` on purpose: a new widget type does not
 * compile until it says what it reads, so it cannot silently ship with an
 * empty (or unbounded) share payload.
 *
 * Kept honest by `fields.test.tsx`, which renders every widget from its full
 * demo payload and from this projection of it and requires the two to match —
 * so a field a renderer reads but this list forgets fails a test, not a share
 * page.
 */
export const WIDGET_FIELDS: Record<WidgetType, readonly string[]> = {
  "railway-tracker": ["deployHealth"],
  "railway-services": ["items"],
  "railway-fleet": ["fleet"],
  "railway-resources": ["resources"],
  "railway-usage": ["usage"],
  "railway-deploys": ["recentDeploys"],
  "railway-projects": ["projects"],
  "railway-billing": ["billing"],
  "railway-cpu": ["metrics"],
  "railway-memory": ["metrics"],
  "railway-egress": ["metrics"],
  "railway-disk": ["metrics"],

  "netlify-tracker": ["items", "trackers"],
  "netlify-sites": ["items"],
  "netlify-health": ["healthy", "total"],
  "netlify-deploys": ["recentDeploys"],
  "netlify-builds": ["buildMinutes"],
  "netlify-forms": ["forms", "formSubmissionsTotal"],

  "supabase-health": ["healthy", "total"],
  "supabase-projects": ["items"],
  "supabase-services": ["services"],
  "supabase-traffic": ["traffic"],
  "supabase-requests": ["requestVolume"],
  "supabase-advisors": ["advisors"],
  "supabase-advisor-issues": ["advisorIssues"],

  "stripe-mrr": ["revenue"],
  "stripe-revenue": ["revenue", "volume30d"],
  "stripe-payments": ["payments"],

  "lemonsqueezy-mrr": ["revenue"],
  "lemonsqueezy-revenue": ["revenue", "revenue30d"],
  "lemonsqueezy-orders": ["orders"],

  "sentry-issues": ["unresolved", "events24h", "truncated"],
  "sentry-recent": ["issues"],
  "sentry-projects": ["projects"],

  "resend-domains": ["domains"],
  "resend-emails": ["emails", "emailsUnavailable"],
  "resend-broadcasts": ["broadcasts", "broadcastsUnavailable"],
  "resend-delivery": ["metrics", "metricsUnavailable"],
  "resend-open-rate": ["metrics", "metricsUnavailable"],
  "resend-click-rate": ["metrics", "metricsUnavailable"],
  "resend-outcomes": ["metrics", "metricsUnavailable"],

  "vercel-tracker": ["trackers"],
  "vercel-projects": ["items"],
  "vercel-deploys": ["recentDeploys"],

  "qonto-balance": ["balances", "liquidity"],
  "qonto-liquidity": ["liquidity"],
  "qonto-cashflow": ["cashflow30d"],
  "qonto-in-out": ["cashflow30d"],
  "qonto-accounts": ["balances"],
  "qonto-history": ["balanceHistory"],
  "qonto-transactions": ["transactions", "nextCursor", "hasMore"],

  "status-board": ["items"],
};

/**
 * Fields every widget frame reads regardless of type: the empty, demo and
 * sync-state envelope. Underscore-prefixed keys (`_sync`, `_demo`) are
 * metadata the server adds, never provider data.
 */
const FRAME_FIELDS = new Set(["needsConnection", "provider", "error"]);

/**
 * Keep only what the given widget types read.
 *
 * Unknown fields are dropped rather than passed through: forgetting to list a
 * field shows up as an empty widget on a share page, while passing everything
 * through would show up as nothing at all — until someone opens the network
 * tab.
 */
export function projectPayload(
  types: Iterable<WidgetType>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(FRAME_FIELDS);
  for (const type of types) {
    for (const field of WIDGET_FIELDS[type] ?? []) allowed.add(field);
  }

  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.startsWith("_") || allowed.has(key)) projected[key] = value;
  }
  return projected;
}
