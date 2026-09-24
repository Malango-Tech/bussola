import { railwayGraphql, type RailwayAuth } from "./client";

/** The projects a token can see, with each service's latest deployment. */

export type ProjectNode = {
  id: string;
  name: string;
  environments?: {
    edges: Array<{ node: { id: string; name: string; isEphemeral?: boolean } }>;
  };
  services: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        serviceInstances: {
          edges: Array<{
            node: {
              environmentId?: string;
              latestDeployment?: {
                id?: string;
                status: string;
                createdAt: string;
                meta?: Record<string, unknown> | null;
              } | null;
            };
          }>;
        };
      };
    }>;
  };
};

/** One selection for both queries, so the two token kinds see the same shape. */
const PROJECT_FIELDS = `
  id
  name
  environments {
    edges {
      node {
        id
        name
        isEphemeral
      }
    }
  }
  services {
    edges {
      node {
        id
        name
        serviceInstances {
          edges {
            node {
              environmentId
              latestDeployment {
                id
                status
                createdAt
                meta
              }
            }
          }
        }
      }
    }
  }
`;

const PROJECT_QUERY = `query ($id: String!) {
  project(id: $id) { ${PROJECT_FIELDS} }
}`;

const ACCOUNT_PROJECTS_QUERY = `query ($workspaceId: String) {
  projects(workspaceId: $workspaceId) {
    edges { node { ${PROJECT_FIELDS} } }
  }
}`;

/**
 * A project token sees exactly one project; an account or workspace token
 * lists every project it can reach (scoped to the workspace when it has one).
 */
export async function fetchProjects(
  token: string,
  auth: RailwayAuth,
): Promise<ProjectNode[]> {
  if (auth.mode === "project" && auth.projectId) {
    const data = await railwayGraphql<{ project: ProjectNode }>(
      token,
      PROJECT_QUERY,
      "project",
      { id: auth.projectId },
    );
    return [data.project];
  }

  const data = await railwayGraphql<{
    projects: { edges: Array<{ node: ProjectNode }> };
  }>(token, ACCOUNT_PROJECTS_QUERY, "account", {
    workspaceId: auth.workspaceId ?? null,
  });
  return data.projects.edges.map((e) => e.node);
}

export function pickEnvironmentId(
  project: ProjectNode,
  preferred?: string,
): string | undefined {
  if (preferred) return preferred;
  const envs = project.environments?.edges.map((e) => e.node) || [];
  const production = envs.find(
    (e) => e.name.toLowerCase() === "production" && !e.isEphemeral,
  );
  return production?.id || envs.find((e) => !e.isEphemeral)?.id || envs[0]?.id;
}
