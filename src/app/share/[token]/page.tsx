import type { Metadata } from "next";
import { SharedCanvas } from "@/components/dashboard/shared-canvas";
import type { CanvasWidget } from "@/components/dashboard/dashboard-canvas";
import { LIMITS, rateLimit } from "@/lib/http/rate-limit";
import { recordShareView, resolveShare } from "@/lib/sharing/resolve";
import { hashToken, looksLikeToken } from "@/lib/sharing/tokens";
import { toCanvasWidget } from "@/lib/widgets/serialize";

export const runtime = "nodejs";

/*
 * Never cached and never rendered ahead of time: the token is the credential,
 * and a shared dashboard shows live numbers. A statically rendered variant
 * would serve one visitor's data to the next.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

/**
 * Shared dashboards must not turn up in search results.
 *
 * The link is unguessable, so the realistic leak is not someone finding it but
 * a crawler following it out of a chat log or a referrer header and putting it
 * in an index. `noindex` on the page plus the disallow in robots.txt is what
 * keeps an unlisted link unlisted.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function SharedDashboardPage({ params }: Props) {
  const { token } = await params;

  // Checked before the lookup, so a flood of requests for one token costs a
  // map read rather than a database round trip each.
  // A malformed token gets no bucket of its own; it falls through to the
  // same "no longer active" page resolveShare leads to.
  const limited = looksLikeToken(token)
    ? rateLimit(`share-page:${hashToken(token)}`, LIMITS.sharePage)
    : { ok: true };
  if (!limited.ok) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="max-w-sm space-y-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            Too many requests
          </h1>
          <p className="text-sm text-muted-foreground">
            This link is being opened faster than it can be served. Try again in
            a moment.
          </p>
        </div>
      </main>
    );
  }

  const share = await resolveShare(token);

  if (!share) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="max-w-sm space-y-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            This link is no longer active
          </h1>
          <p className="text-sm text-muted-foreground">
            It may have been revoked or reached its expiry date. Ask whoever
            shared it for a new one.
          </p>
        </div>
      </main>
    );
  }

  const widgets: CanvasWidget[] = (
    await share.repos.widgets.listFor(share.dashboardId)
  ).map(toCanvasWidget);

  // Not awaited: a view counter must never be what makes a page slow, and a
  // failed count is logged rather than surfaced.
  void recordShareView(share.shareId);

  return (
    <main className="min-h-dvh">
      <SharedCanvas
        token={token}
        dashboardName={share.dashboardName}
        widgets={widgets}
        whiteLabel={share.whiteLabel}
      />
    </main>
  );
}
