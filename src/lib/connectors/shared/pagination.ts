/**
 * Walk a paginated endpoint up to a fixed number of pages.
 *
 * Every paginated connector caps its walk so one very large account cannot
 * stall the sync worker's whole batch, and reports when the cap cut it short
 * so the widget can say its numbers are partial rather than pass them off as
 * complete. Providers disagree on how the next page is named — Stripe hands
 * back the last id (`starting_after`), Lemon Squeezy and Qonto a page number —
 * so the caller decides that, and this owns the loop and the cap.
 */

export type Page<TItem, TCursor> = {
  items: TItem[];
  /** Where the next page starts, or null/undefined when this was the last. */
  next?: TCursor | null;
};

export async function collectPages<TItem, TCursor>(
  fetchPage: (cursor: TCursor | undefined) => Promise<Page<TItem, TCursor>>,
  maxPages: number,
): Promise<{ items: TItem[]; truncated: boolean }> {
  const items: TItem[] = [];
  let cursor: TCursor | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (result.next === null || result.next === undefined) {
      return { items, truncated: false };
    }
    cursor = result.next;
  }

  // Out of pages while the provider still had more to give.
  return { items, truncated: true };
}
