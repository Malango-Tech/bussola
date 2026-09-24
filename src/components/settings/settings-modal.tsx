"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CreditCardIcon,
  GearSixIcon,
  PlugIcon,
  UserCircleIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { authClient } from "@/lib/auth/client";
import { SectionHeading } from "@/components/layout/page";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BillingSection } from "@/components/settings/billing-section";
import { MembersSection } from "@/components/settings/members-section";
import { McpSection } from "@/components/settings/mcp-section";
import {
  type SettingsTab,
  useSettingsModal,
} from "@/components/settings/settings-modal-context";
import { cn } from "@/lib/utils";

const NAV: Array<{
  tab: SettingsTab;
  label: string;
  icon: typeof GearSixIcon;
}> = [
  { tab: "general", label: "General", icon: GearSixIcon },
  { tab: "account", label: "Account", icon: UserCircleIcon },
  { tab: "members", label: "Members", icon: UsersThreeIcon },
  { tab: "mcp", label: "MCP", icon: PlugIcon },
  { tab: "billing", label: "Billing", icon: CreditCardIcon },
];

const TAB_LABEL: Record<SettingsTab, string> = {
  general: "General",
  account: "Account",
  members: "Members",
  mcp: "MCP",
  billing: "Billing",
};

export function SettingsModal() {
  const { open, tab, setTab, close } = useSettingsModal();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(680px,90vh)] w-[min(860px,96vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-none sm:flex-row"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <nav
          aria-label="Settings sections"
          className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border p-3 sm:w-56 sm:flex-col sm:gap-0.5 sm:overflow-visible sm:border-r sm:border-b-0 sm:p-4"
        >
          <p className="hidden px-2.5 pb-2 text-xs font-medium text-muted-foreground sm:block">
            Settings
          </p>
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = tab === item.tab;
            return (
              <button
                key={item.tab}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(item.tab)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
            <h2 className="font-heading text-base font-medium">
              {TAB_LABEL[tab]}
            </h2>
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <XIcon className="size-4" aria-hidden />
              <span className="sr-only">Close</span>
            </DialogClose>
          </header>

          <div className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
            {tab === "general" ? <GeneralTab /> : null}
            {tab === "account" ? <AccountTab /> : null}
            {tab === "members" ? <MembersSection /> : null}
            {tab === "mcp" ? <McpSection /> : null}
            {tab === "billing" ? <BillingSection /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GeneralTab() {
  const [encryptionConfigured, setEncryptionConfigured] = useState(false);

  useEffect(() => {
    void fetch("/api/status")
      .then((r) => r.json())
      .then((data: { encryptionConfigured?: boolean }) => {
        setEncryptionConfigured(Boolean(data.encryptionConfigured));
      });
  }, []);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeading
          title="Appearance"
          description="Light and dark mode follow the Bussola palette."
          actions={<ThemeToggle />}
        />
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <SectionHeading
          title="Encryption"
          description="Secrets are stored on this machine, encrypted at rest with AES-256-GCM."
        />
        <div className="flex items-center gap-2">
          <Badge variant={encryptionConfigured ? "secondary" : "outline"}>
            {encryptionConfigured ? "Custom key set" : "Generated local key"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Without <code className="text-foreground">BUSSOLA_ENCRYPTION_KEY</code>,
          a random key is generated in the data directory. Back it up with the
          database: without it, stored credentials cannot be decrypted.
        </p>
      </section>
    </div>
  );
}

function AccountTab() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    // revokeOtherSessions signs out every other device; this one stays valid,
    // so there is no need to bounce the user back to the login screen.
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setSaving(false);

    if (error) {
      toast.error(error.message || "Failed to change password");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    toast.success("Password updated — other devices signed out");
  }

  return (
    <section className="space-y-4">
      <SectionHeading title="Change password" />
      <form onSubmit={changePassword} className="max-w-sm space-y-4">
        <div className="space-y-2">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? "Updating…" : "Update password"}
        </Button>
      </form>
    </section>
  );
}
