"use client";

import { useState, useTransition } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createDashboardAction } from "./actions";

export function CreateDashboard({ label = "New dashboard" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim()) return;
    const formData = new FormData();
    formData.set("name", name);

    startTransition(async () => {
      // A successful create redirects, so only failures return here.
      const result = await createDashboardAction(formData);
      if (result && !result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      setName("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button">
            <PlusIcon className="size-4" aria-hidden />
            {label}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create dashboard</DialogTitle>
          <DialogDescription>
            Give it a clear name — you can rename it later.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Dashboard name"
          placeholder="Ops overview"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          autoFocus
        />
        <DialogFooter>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
