"use client";

import { cloneElement, useActionState, useState, type ReactElement } from "react";
import { createSite, updateSite, type ActionState } from "../actions";
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

export type EditableSite = {
  id: string;
  name: string;
  shortCode: string | null;
  openingDate: Date | null;
  note: string | null;
};

/** yyyy-mm-dd for <input type="date">, in the server's local time (dates are stored at midnight UTC on import/create). */
function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * plan.md section 4.6 — Sites (Admin): add, rename, opening date, short
 * code, note. Gated to WEBSITE_LIVE by the Server Action. See
 * item-form-dialog.tsx for why this is split into an outer/inner pair
 * (avoids closing the dialog via a setState-in-effect).
 */
export function SiteFormDialog({
  site,
  trigger,
}: {
  site?: EditableSite;
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
      <SiteFormDialogContent key={instanceKey} open={open} onOpenChange={setOpen} site={site} />
    </>
  );
}

function SiteFormDialogContent({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site?: EditableSite;
}) {
  const isEdit = Boolean(site);
  const boundAction = isEdit ? updateSite.bind(null, site!.id) : createSite;
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);
  const dialogOpen = open && !state?.success;

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${site!.name}` : "Add site"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Name, short code, opening date and note." : "Creates a new site with zero quantities everywhere."}
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required defaultValue={site?.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="shortCode">Short code</Label>
              <Input id="shortCode" name="shortCode" defaultValue={site?.shortCode ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="openingDate">Opening date</Label>
              <Input id="openingDate" name="openingDate" type="date" defaultValue={toDateInputValue(site?.openingDate ?? null)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" name="note" defaultValue={site?.note ?? ""} />
          </div>

          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save changes" : "Create site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
