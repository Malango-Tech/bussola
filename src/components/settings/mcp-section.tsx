"use client";

import { useCallback, useEffect, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { CopyIcon, ProhibitIcon, WarningIcon } from "@phosphor-icons/react";
import { readJson } from "@/components/api-client";
import { SectionHeading } from "@/components/layout/page";
import { PermissionHint } from "@/components/layout/permission-hint";
import { useCan } from "@/components/providers/role-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type ApiToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: "read" | "write";
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type Payload = {
  tokens: ApiToken[];
  canUseMcp: boolean;
  planName: string;
};

/**
 * Tokens for the MCP server, and how to point a client at it.
 *
 * The config snippet is shown alongside the token rather than in
 * documentation, because the token is visible exactly once and the snippet is
 * the only thing anyone wants to do with it at that moment.
 */
export function McpSection() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  // Members can see which tokens exist — they may be asked to use one — but
  // minting or revoking a credential for the whole organization is an admin's.
  const canManage = useCan("manageTokens");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tokens");
      if (!res.ok) return;
      setData((await res.json()) as Payload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);

    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), scope }),
    });
    const json = await readJson<{ token: string }>(res);
    setCreating(false);

    if (!res.ok || !json.token) {
      toast.error(json.error || "Could not create the token");
      return;
    }

    setFreshToken(json.token);
    setName("");
    await load();
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/tokens?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error((await readJson(res)).error || "Could not revoke the token");
      return;
    }
    toast.success("Token revoked");
    await load();
  }

  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading tokens">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Could not load tokens. Try reopening settings.
      </p>
    );
  }

  const active = data.tokens.filter((token) => !token.revokedAt);
  const endpoint =
    typeof window === "undefined" ? "" : `${window.location.origin}/api/mcp`;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeading
          title="MCP server"
          description="Point an assistant at Bussola and it can read every connector and rearrange your dashboards."
        />

        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">What it can and cannot do</p>
          <ul className="space-y-1 text-muted-foreground">
            <li>· Read data across every connected source</li>
            <li>· Create dashboards, add, move and remove widgets</li>
            <li>· Never reads or edits credentials — the web UI is the only place</li>
            <li>· Never writes to a third-party system</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            These are properties of the server, not instructions to the model:
            there is no tool that returns a credential or touches a provider.
          </p>
        </div>

        {!data.canUseMcp ? (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <WarningIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <span>
              The MCP server is not part of the {data.planName} plan. Solo and
              Team both include it, and self-hosted has it unlocked.
            </span>
          </p>
        ) : null}
      </section>

      {freshToken ? (
        <section
          aria-labelledby="fresh-token-title"
          className="space-y-2 rounded-lg border border-success/40 bg-success/5 p-3"
        >
          <p id="fresh-token-title" role="status" className="text-sm font-medium">
            Copy this token now — it is not shown again.
          </p>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              aria-label="New token"
              value={freshToken}
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy token"
              onClick={() => copy(freshToken)}
            >
              <CopyIcon className="size-4" aria-hidden />
            </Button>
          </div>

          <p className="pt-1 text-xs font-medium">Add it to your MCP client:</p>
          <pre className="overflow-x-auto rounded-md bg-background p-2.5 font-mono text-[11px] leading-relaxed">
            {configSnippet(endpoint, freshToken)}
          </pre>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => copy(configSnippet(endpoint, freshToken))}
          >
            <CopyIcon className="size-3.5" />
            Copy config
          </Button>
        </section>
      ) : null}

      {data.canUseMcp && !canManage ? (
        <section className="space-y-3 border-t border-border pt-6">
          <SectionHeading title="New token" />
          <PermissionHint permission="manageTokens">
            create or revoke MCP tokens
          </PermissionHint>
        </section>
      ) : null}

      {data.canUseMcp && canManage ? (
        <section className="space-y-3 border-t border-border pt-6">
          <SectionHeading title="New token" />
          <form onSubmit={create} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1 space-y-1.5">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                required
                value={name}
                placeholder="e.g. Claude Desktop"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="w-40 space-y-1.5">
              <Label htmlFor="token-scope">Access</Label>
              <Select
                id="token-scope"
                value={scope}
                onChange={(event) =>
                  setScope(event.target.value as "read" | "write")
                }
              >
                <option value="read">Read only</option>
                <option value="write">Read and write</option>
              </Select>
            </div>
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? "Creating…" : "Create token"}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Read-only tokens are refused every tool that changes anything, at
            the server rather than by asking the model nicely.
          </p>
        </section>
      ) : null}

      <section className="space-y-3 border-t border-border pt-6">
        <SectionHeading
          title="Active tokens"
          description={
            endpoint ? `Endpoint: ${endpoint}` : "Endpoint: /api/mcp"
          }
        />
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {active.map((token) => (
              <li
                key={token.id}
                className="flex items-center gap-3 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{token.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {token.tokenPrefix}…{" "}
                    <span className="font-sans">
                      ·{" "}
                      {token.lastUsedAt
                        ? `used ${formatDistanceToNow(new Date(token.lastUsedAt), { addSuffix: true })}`
                        : "never used"}
                      {token.expiresAt
                        ? ` · expires ${format(new Date(token.expiresAt), "d MMM yyyy")}`
                        : ""}
                    </span>
                  </p>
                </div>
                <Badge variant={token.scope === "write" ? "warning" : "outline"}>
                  {token.scope}
                </Badge>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Revoke ${token.name}`}
                    onClick={() => revoke(token.id)}
                  >
                    <ProhibitIcon className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function copy(value: string) {
  void navigator.clipboard
    .writeText(value)
    .then(() => toast.success("Copied"))
    .catch(() => toast.error("Could not copy — select and copy manually"));
}

/** The shape every MCP client understands for a remote HTTP server. */
function configSnippet(endpoint: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        bussola: {
          type: "http",
          url: endpoint || "http://localhost:3000/api/mcp",
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}
