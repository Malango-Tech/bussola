import Stripe from "stripe";
import { isCloud } from "@/lib/edition";
import { env } from "@/lib/env";

/** Pinned so a Stripe-side default change cannot alter payload shapes silently. */
const API_VERSION = "2026-08-26.dahlia";

let client: Stripe | undefined;

export class BillingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingUnavailableError";
  }
}

/** True when this deployment can actually take money. */
export function billingConfigured(): boolean {
  return isCloud && Boolean(env().STRIPE_SECRET_KEY);
}

/**
 * The Stripe client, created on first use.
 *
 * Self-hosted never reaches this: `entitlementsFor` grants everything without
 * consulting billing, and the billing routes refuse before constructing it.
 */
export function getStripe(): Stripe {
  if (!isCloud) {
    throw new BillingUnavailableError(
      "Billing is only available in the hosted edition.",
    );
  }
  const key = env().STRIPE_SECRET_KEY;
  if (!key) {
    throw new BillingUnavailableError("STRIPE_SECRET_KEY is not configured.");
  }
  client ??= new Stripe(key, { apiVersion: API_VERSION });
  return client;
}

export function webhookSecret(): string {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new BillingUnavailableError(
      "STRIPE_WEBHOOK_SECRET is not configured.",
    );
  }
  return secret;
}

export function appUrl(): string {
  // Cloud requires BETTER_AUTH_URL, so this fallback only ever applies to a
  // self-hosted install poking at billing, where it is inert anyway.
  return env().BETTER_AUTH_URL ?? "http://localhost:3000";
}
