"use client";

import { useState } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { readJson } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PROVIDER_CATALOG } from "@/lib/connectors/catalog";
import type { Provider } from "@/lib/providers";

/** What the person types; only the fields this provider uses are shown. */
type Credentials = {
  apiKey: string;
  login: string;
  secretKey: string;
  orgSlug: string;
};

const EMPTY_CREDENTIALS: Credentials = {
  apiKey: "",
  login: "",
  secretKey: "",
  orgSlug: "",
};

type Props = {
  provider: Provider;
  /** Present when replacing the credentials of an existing connection. */
  connectionId?: string;
  currentLabel?: string;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Connect a source, or replace an existing one's credentials.
 *
 * Existing secrets are never sent back to the browser, so editing always means
 * entering a fresh token rather than revealing the stored one. Saving always
 * tests the credentials before reporting success — a connection that saves but
 * does not work is worse than a visible failure.
 */
export function ConnectionDialog({
  provider,
  connectionId,
  currentLabel,
  onClose,
  onSaved,
}: Props) {
  const entry = PROVIDER_CATALOG[provider];
  const [label, setLabel] = useState(currentLabel ?? entry.name);
  const [credentials, setCredentials] = useState(EMPTY_CREDENTIALS);
  const [saving, setSaving] = useState(false);
  const { apiKey, login, secretKey, orgSlug } = credentials;

  /** An onChange for one credential field. */
  const field =
    (name: keyof Credentials) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setCredentials((prev) => ({ ...prev, [name]: value }));
    };

  const isEdit = Boolean(connectionId);
  const canSubmit = apiKey.trim().length > 0 || secretKey.trim().length > 0;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: connectionId,
          provider,
          label: label.trim() || entry.name,
          credentials: {
            apiKey: apiKey.trim() || undefined,
            login: login.trim() || undefined,
            secretKey: secretKey.trim() || undefined,
            orgSlug: orgSlug.trim() || undefined,
          },
          test: true,
        }),
      });
      const data = await readJson<{
        testResult: { ok: boolean; message: string } | null;
      }>(res);

      if (!res.ok) {
        toast.error(data.error || "Could not save the connection");
        return;
      }
      if (data.testResult && !data.testResult.ok) {
        // Saved, but the credentials do not work — say so plainly and keep the
        // dialog open so it can be corrected without retyping everything.
        toast.error(data.testResult.message);
        return;
      }

      toast.success(
        data.testResult?.message ?? `${entry.name} connected`,
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Update ${entry.name}` : `Connect ${entry.name}`}
          </DialogTitle>
          <DialogDescription>{entry.tagline}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="connection-label">Name</Label>
            <Input
              id="connection-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={entry.name}
            />
          </div>

          {entry.fields.includes("apiKey") ? (
            <div className="space-y-2">
              <Label htmlFor="connection-api-key">
                {provider === "qonto" ? "API key (login:secret)" : "API token"}
              </Label>
              <Input
                id="connection-api-key"
                type="password"
                value={apiKey}
                onChange={field("apiKey")}
                autoComplete="off"
                autoFocus
                placeholder={isEdit ? "Enter a new token to replace the stored one" : undefined}
              />
            </div>
          ) : null}

          {entry.fields.includes("orgSlug") ? (
            <div className="space-y-2">
              <Label htmlFor="connection-org-slug">
                {entry.orgSlugLabel || "Organization"}
              </Label>
              <Input
                id="connection-org-slug"
                value={orgSlug}
                onChange={field("orgSlug")}
                autoComplete="off"
              />
            </div>
          ) : null}

          {entry.fields.includes("login") ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="connection-login">Or login</Label>
                <Input
                  id="connection-login"
                  value={login}
                  onChange={field("login")}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="connection-secret-key">Secret key</Label>
                <Input
                  id="connection-secret-key"
                  type="password"
                  value={secretKey}
                  onChange={field("secretKey")}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground text-balance">
            {entry.hint}
            {entry.docsUrl ? (
              <>
                {" "}
                <a
                  href={entry.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
                >
                  Open {entry.name}
                  <ArrowSquareOutIcon className="size-3" aria-hidden />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </>
            ) : null}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !canSubmit}
            onClick={() => void save()}
          >
            {saving ? "Testing…" : isEdit ? "Save & test" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
