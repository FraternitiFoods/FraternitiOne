"use client";

import { cloneElement, useActionState, useState, type ReactElement } from "react";
import { updateDashboardSiteDetails, type ActionState } from "../actions";
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
import { DEPT_LINKS_TEXT_MAX } from "@/lib/dashboard-site-input";

export type EditableDashboardSite = {
  id: string;
  name: string;
  driveFolderUrl: string | null;
  deptLinksText: string | null;
};

/** Admin-only "Edit details" for a website-created site: Drive folder link + free-text department links. */
export function EditSiteDialog({
  site,
  trigger,
}: {
  site: EditableDashboardSite;
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
      <EditSiteDialogContent key={instanceKey} open={open} onOpenChange={setOpen} site={site} />
    </>
  );
}

function EditSiteDialogContent({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: EditableDashboardSite;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateDashboardSiteDetails.bind(null, site.id),
    undefined
  );
  const dialogOpen = open && !state?.success;

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {site.name}</DialogTitle>
          <DialogDescription>Drive folder link and department links.</DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="driveFolderUrl">Drive folder link</Label>
            <Input
              id="driveFolderUrl"
              name="driveFolderUrl"
              type="url"
              defaultValue={site.driveFolderUrl ?? ""}
              placeholder="https://drive.google.com/drive/folders/…"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deptLinksText">Department links</Label>
            <Textarea
              id="deptLinksText"
              name="deptLinksText"
              rows={6}
              maxLength={DEPT_LINKS_TEXT_MAX}
              defaultValue={site.deptLinksText ?? ""}
              placeholder={"interiors --> https://drive.google.com/…\nlegal --> https://…"}
            />
          </div>

          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
