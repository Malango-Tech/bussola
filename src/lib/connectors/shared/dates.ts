/** Time windows and orderings the connectors all ask for. */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant `days` days before now. */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function time(value: string): number {
  return new Date(value).getTime();
}

/**
 * Sort comparator for newest-first lists keyed by a timestamp string.
 *
 * Compares parsed times rather than strings: providers mix `Z` and offset
 * suffixes and fractional seconds, which sort wrongly as text.
 */
export function byNewest<T>(
  timestamp: (item: T) => string,
): (a: T, b: T) => number {
  return (a, b) => time(timestamp(b)) - time(timestamp(a));
}

/** Sort comparator for oldest-first lists, e.g. a deploy trail read left to right. */
export function byOldest<T>(
  timestamp: (item: T) => string,
): (a: T, b: T) => number {
  return (a, b) => time(timestamp(a)) - time(timestamp(b));
}
