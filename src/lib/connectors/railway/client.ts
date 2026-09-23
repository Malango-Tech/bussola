import { fetchJson } from "../http";
import { connectorLogger, describeError } from "../shared/log";

/**
 * Railway's GraphQL client and token-kind detection.
 *
 * Every other module in this folder goes through `railwayGraphql`, and needs
 * the `AuthMode` that `resolveRailwayAuth` works out, because Railway sends the
 * same token in a different header depending on what kind of token it is.
 */

const ENDPOINT = "https://backboard.railway.com/graphql/v2";

const log = connectorLogger("railway");

export type AuthMode = "account" | "project";

export async function railwayGraphql<T>(
  token: string,
  query: string,
  mode: AuthMode,
  variables?: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (mode === "project") {
    headers["Project-Access-Token"] = token;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }

  const json = await fetchJson<{
    data?: T;
    errors?: Array<{ message: string; path?: Array<string | number> }>;
  }>(
    ENDPOINT,
    { method: "POST", headers, body: JSON.stringify({ query, variables }) },
    { label: "Railway" },
  );

  /*
   * GraphQL reports per-field failures alongside the data that did resolve, and
   * Railway uses that: a token that cannot see one project in a workspace still
   * returns every other project, with a "Not Authorized" entry for the one it
   * cannot. Treating any error as fatal threw all of it away and failed the
   * whole dashboard over a single inaccessible field.
   *
   * So errors are only fatal when nothing came back with them.
   */
  if (!json.data) {
    const first = json.errors?.[0];
    const where = first?.path?.length ? ` (at ${first.path.join(".")})` : "";
    throw new Error(
      first?.message ? `${first.message}${where}` : "Empty Railway response",
    );
  }

  if (json.errors?.length) {
    log.warn("partial GraphQL response", {
      paths: json.errors.map((e) => (e.path?.length ? e.path.join(".") : "?")),
      reason: json.errors[0]?.message,
    });
  }

  return json.data;
}

export type RailwayAuth = {
  mode: AuthMode;
  projectId?: string;
  environmentId?: string;
  /** Set for a workspace API token, which scopes every project query. */
  workspaceId?: string;
  label: string;
};

/**
 * Work out which of Railway's three token kinds this is.
 *
 * Each has its own identity query, and only one of them answers for any given
 * token: `projectToken` for a project token, `apiToken` for a workspace token,
 * `me` for a personal one. A workspace token belongs to no user, so asking `me`
 * about it returns "Not Authorized" — which used to look identical to a revoked
 * token and failed the whole connection.
 */
export async function resolveRailwayAuth(token: string): Promise<RailwayAuth> {
  try {
    const projectAuth = await railwayGraphql<{
      projectToken: { projectId: string; environmentId: string };
    }>(token, `query { projectToken { projectId environmentId } }`, "project");

    let label = "Railway project";
    try {
      const project = await railwayGraphql<{
        project: { name?: string };
      }>(
        token,
        `query ($id: String!) { project(id: $id) { name } }`,
        "project",
        { id: projectAuth.projectToken.projectId },
      );
      if (project.project.name) label = project.project.name;
    } catch (error) {
      // The name only labels the connection; the token itself is proven good.
      log.debug("project name lookup failed", {
        projectId: projectAuth.projectToken.projectId,
        reason: describeError(error),
      });
    }

    return {
      mode: "project",
      projectId: projectAuth.projectToken.projectId,
      environmentId: projectAuth.projectToken.environmentId,
      label,
    };
  } catch (error) {
    // Expected for every account and workspace token; fall through to Bearer.
    log.debug("not a project token", { reason: describeError(error) });
  }

  // Workspace API token: no user behind it, but it names the workspaces it can
  // reach, which is what scopes every project query that follows.
  try {
    const api = await railwayGraphql<{
      apiToken: { workspaces?: Array<{ id?: string; name?: string }> } | null;
    }>(token, `query { apiToken { workspaces { id name } } }`, "account");

    const workspace = api.apiToken?.workspaces?.[0];
    if (workspace?.id) {
      return {
        mode: "account",
        workspaceId: workspace.id,
        label: workspace.name || "Railway workspace",
      };
    }
  } catch (error) {
    // Expected for a personal token; try `me` next.
    log.debug("not a workspace token", { reason: describeError(error) });
  }

  const account = await railwayGraphql<{
    me: { name?: string; email?: string };
  }>(token, `query { me { name email } }`, "account");

  return {
    mode: "account",
    label: account.me.name || account.me.email || "Railway account",
  };
}
