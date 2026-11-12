"use client";

import { cloneElement, useState, useTransition, type ReactElement } from "react";
import { deleteDashboardSite } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { deleteSiteConfirmPhrase } from "@/lib/dashboard-site-input";

/**
 * Admin-only "Delete site" with a type-to-confirm step: the Delete button stays
 * disabled until the exact phrase "Delete site <name>" is typed. This is only
 * the friendly half — deleteDashboardSite re-checks the role, the phrase and
 * the site's state on the server. Outer/inner split (same as edit-site-dialog.tsx)
 * so the typed text and any error reset every time the dialog is reopened.
 */
export function DeleteSiteDialog({
  site,
  trigger,
}: {
  site: { id: string; name: string };
  trigger: ReactElement<{ onClick?: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const [instanceKey, setInstanceKey] = useState(0);

  return (
    <>
      {cloneElement(trigger, {
        onClick: () => {
          setInstanceKey((k) => k + 1);
          setOpen(true);
        },
      })}
      <DeleteSiteDialogContent key={instanceKey} open={open} onOpenChange={setOpen} site={site} />
    </>
  );
}

function DeleteSiteDialogContent({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: { id: string; name: string };
}) {
  const phrase = deleteSiteConfirmPhrase(site.name);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirmed = typed.trim() === phrase;

  function submit() {
    if (!confirmed || pending) return;
    setError(null);
    startTransition(async () => {
      // On success the action redirects to /dashboard (never returns); it only returns on a refusal.
      const result = await deleteDashboardSite(site.id, typed).catch(() => ({
        error: "Could not delete the site. Check your connection and try again.",
      }));
      if (result?.error) setError(result.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {site.name}?</DialogTitle>
          <DialogDescription>
            This permanently deletes the site and everything attached to it: its Dashboard progress, Site Tracker steps and
            uploaded evidence, Site BOQ quantities and Operations BOQ rows. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="delete-site-confirm">
              Type <span className="font-mono font-semibold text-foreground">{phrase}</span> to confirm
            </Label>
            <Input
              id="delete-site-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              disabled={pending}
              placeholder={phrase}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
            <Button type="submit" variant="destructive" disabled={!confirmed || pending}>
              {pending ? "Deleting…" : "Delete site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
