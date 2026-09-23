import { jsonError, jsonOk, withTenant } from "@/lib/api";
import { testAndPersist } from "@/lib/connectors";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Re-test a connection's stored credentials against its provider.
 *
 * An id this tenant does not own is a 404 before anything else happens, the
 * same answer as the sync route: `testAndPersist` would also refuse it, but
 * as a 200 carrying a failed result, which reads like "your credentials are
 * wrong" rather than "there is no such connection".
 */
export async function POST(_request: Request, { params }: Params) {
  return withTenant(async (repos) => {
    const { id } = await params;
    if (!(await repos.connections.get(id))) {
      return jsonError("Connection not found", 404);
    }
    return jsonOk({ result: await testAndPersist(repos, id) });
  });
}
