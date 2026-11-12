"use client";

import { cloneElement, useActionState, useState, type ReactElement } from "react";
import { createDashboardSite, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { DEPT_LINKS_TEXT_MAX, SITE_NAME_MAX } from "@/lib/dashboard-site-input";

/**
 * Admin-only "New site" dialog. Outer/inner split (same as site-boq's
 * SiteFormDialog) so reopening remounts the form with fresh state instead of
 * resetting it in an effect. On success the Server Action redirects to the
 * new site's page, so there is no success state to handle here.
 */
export function CreateSiteDialog({ trigger }: { trigger: ReactElement<{ onClick?: () => void }> }) {
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
      <CreateSiteDialogContent key={instanceKey} open={open} onOpenChange={setOpen} />
    </>
  );
}

function CreateSiteDialogContent({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createDashboardSite, undefined);

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New site</DialogTitle>
          <DialogDescription>
            Creates the site with the full step checklist, all assigned to Admin. The Drive folder and department
            links are optional — add them now or later.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Site name</Label>
            <Input id="name" name="name" required maxLength={SITE_NAME_MAX} autoFocus autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="driveFolderUrl">Drive folder link (optional)</Label>
            <Input
              id="driveFolderUrl"
              name="driveFolderUrl"
              type="url"
              placeholder="https://drive.google.com/drive/folders/…"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deptLinksText">Department links (optional)</Label>
            <Textarea
              id="deptLinksText"
              name="deptLinksText"
              rows={4}
              maxLength={DEPT_LINKS_TEXT_MAX}
              placeholder={"interiors --> https://drive.google.com/…\nlegal --> https://…"}
            />
          </div>

          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
