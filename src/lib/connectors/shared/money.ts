/**
 * Money as providers send it, converted to what the widgets display.
 *
 * Stripe, Lemon Squeezy, Railway's invoice total and Qonto's `*_cents` fields
 * all report integers in the currency's minor unit. Every connector assumes a
 * two-decimal currency, as they did before this was shared; a zero-decimal
 * currency (JPY, KRW) would need the currency passed in here.
 */

const MINOR_PER_MAJOR = 100;

/** Minor units (cents) → major units. A missing amount reads as zero. */
export function toMajor(minor: number | null | undefined): number {
  return (minor ?? 0) / MINOR_PER_MAJOR;
}

/**
 * Prefer a provider's decimal amount and fall back to its cents twin.
 *
 * Qonto sends both `balance` and `balance_cents` (and the same pair on
 * transactions); older payloads can carry only the latter.
 */
export function majorOrMinor(
  major: number | null | undefined,
  minor: number | null | undefined,
): number {
  if (typeof major === "number") return major;
  return toMajor(minor);
}
