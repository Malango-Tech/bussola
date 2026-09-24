import { z } from "zod";
import { jsonError, jsonOk, ROLE_FOR, withTenant } from "@/lib/api";
import { overLimit } from "@/lib/billing/guard";
import { syncNow } from "@/lib/sync/runner";
import {
  COMING_SOON_PROVIDERS,
  LIVE_PROVIDERS,
  listConnections,
  testAndPersist,
  upsertConnection,
} from "@/lib/connectors";

export const runtime = "nodejs";

export async function GET() {
  return withTenant(async (repos) => {
    return jsonOk({
      connections: await listConnections(repos),
      liveProviders: LIVE_PROVIDERS,
      comingSoon: COMING_SOON_PROVIDERS,
    });
  });
}

const upsertSchema = z.object({
  id: z.string().optional(),
  provider: z.enum(LIVE_PROVIDERS),
  label: z.string().min(1).max(80),
  credentials: z.object({
    apiKey: z.string().optional(),
    login: z.string().optional(),
    secretKey: z.string().optional(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    orgSlug: z.string().optional(),
  }),
  test: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withTenant(async (repos) => {
    const body = await request.json().catch(() => null);
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid connection payload");

    // Replacing an existing connection's credentials is always allowed; only
    // adding another one can exceed the plan.
    if (!parsed.data.id) {
      const denied = await overLimit(
        repos,
        "connections",
        await repos.connections.count(),
      );
      if (denied) return denied;
    }

    const id = await upsertConnection(repos, {
      id: parsed.data.id,
      provider: parsed.data.provider,
      label: parsed.data.label,
      credentials: parsed.data.credentials,
    });
    if (!id) return jsonError("Connection not found", 404);

    const testResult =
      parsed.data.test === false ? null : await testAndPersist(repos, id);

    // Fill the snapshot straight away so the tenant's widgets have data before
    // the worker's next tick, rather than showing a spinner after connecting.
    if (testResult?.ok) {
      await syncNow(id);
    }

    return jsonOk({ id, testResult });
  }, { role: ROLE_FOR.manageConnections });
}

export async function DELETE(request: Request) {
  return withTenant(async (repos) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return jsonError("id required");

    const removed = await repos.connections.remove(id);
    if (!removed) return jsonError("Connection not found", 404);
    return jsonOk({ ok: true });
  }, { role: ROLE_FOR.manageConnections });
}
