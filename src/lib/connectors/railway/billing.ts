import type { RailwayBilling } from "../types";
import { toMajor } from "../shared/money";
import { railwayGraphql, type AuthMode } from "./client";

/**
 * Current spend, projected bill and the cycle it belongs to.
 *
 * Only reachable through a workspace: there is no top-level billing query. A
 * project-scoped token cannot see `me` at all, so this returns null for one
 * rather than failing the dashboard.
 */
const CUSTOMER_FIELDS = `
  currentUsage
  creditBalance
  billingPeriod { start end }
  subscriptions {
    nextInvoiceCurrentTotal
    nextInvoiceDate
  }
`;

type RailwayCustomer = {
  currentUsage?: number | null;
  creditBalance?: number | null;
  billingPeriod?: { start?: string; end?: string } | null;
  subscriptions?: Array<{
    nextInvoiceCurrentTotal?: number | null;
    nextInvoiceDate?: string | null;
  }> | null;
};

type RailwayWorkspace = {
  name?: string;
  plan?: string;
  customer?: RailwayCustomer | null;
};

function toBilling(
  workspaceName: string,
  plan: string | undefined,
  customer: RailwayCustomer,
): RailwayBilling {
  const subscription = customer.subscriptions?.[0];
  const cents = subscription?.nextInvoiceCurrentTotal;
  return {
    workspaceName,
    plan,
    currency: "usd",
    // Reported in cents; every other figure here is already in dollars.
    estimatedBill: typeof cents === "number" ? toMajor(cents) : null,
    currentUsage:
      typeof customer.currentUsage === "number" ? customer.currentUsage : null,
    creditBalance:
      typeof customer.creditBalance === "number" ? customer.creditBalance : null,
    cycleStart: customer.billingPeriod?.start || undefined,
    cycleEnd: customer.billingPeriod?.end || undefined,
    nextInvoiceDate: subscription?.nextInvoiceDate || undefined,
  };
}

export async function fetchBilling(
  token: string,
  mode: AuthMode,
  workspaceId?: string,
): Promise<RailwayBilling | null> {
  if (mode !== "account") return null;

  // A workspace token cannot walk `me.workspaces`, but can read the one
  // workspace it belongs to.
  if (workspaceId) {
    try {
      const data = await railwayGraphql<{ workspace: RailwayWorkspace | null }>(
        token,
        `query ($workspaceId: String!) {
          workspace(workspaceId: $workspaceId) {
            name
            plan
            customer { ${CUSTOMER_FIELDS} }
          }
        }`,
        mode,
        { workspaceId },
      );
      const workspace = data.workspace;
      if (!workspace?.customer) return null;
      return toBilling(
        workspace.name || "Workspace",
        workspace.plan,
        workspace.customer,
      );
    } catch {
      return null;
    }
  }

  try {
    const data = await railwayGraphql<{
      me: { workspaces?: RailwayWorkspace[] };
    }>(
      token,
      `query {
        me {
          workspaces {
            name
            plan
            customer { ${CUSTOMER_FIELDS} }
          }
        }
      }`,
      mode,
    );

    // Pick the workspace that actually has billing attached; a member with no
    // billing visibility gets nulls rather than an error.
    const workspace = (data.me.workspaces || []).find((w) => w.customer);
    if (!workspace?.customer) return null;

    return toBilling(
      workspace.name || "Workspace",
      workspace.plan,
      workspace.customer,
    );
  } catch {
    // Billing visibility depends on workspace role; the rest still renders.
    return null;
  }
}
