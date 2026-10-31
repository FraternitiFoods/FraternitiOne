"use client";

import { cloneElement, useActionState, useState, type ReactElement } from "react";
import { updateVendor, type ActionState } from "../actions";
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

export type EditableVendor = {
  id: string;
  name: string;
  address: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
};

/**
 * plan.md section 4.4 — vendor contact details, Admin only, either mode. See
 * item-form-dialog.tsx for why this is split into an outer/inner pair
 * (avoids closing the dialog via a setState-in-effect).
 */
export function VendorEditDialog({
  vendor,
  trigger,
}: {
  vendor: EditableVendor;
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
      <VendorEditDialogContent key={instanceKey} open={open} onOpenChange={setOpen} vendor={vendor} />
    </>
  );
}

function VendorEditDialogContent({
  open,
  onOpenChange,
  vendor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: EditableVendor;
}) {
  const boundAction = updateVendor.bind(null, vendor.id);
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);
  const dialogOpen = open && !state?.success;

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit vendor</DialogTitle>
          <DialogDescription>Contact details feed Purchase Orders — not sheet data, so safe to edit here.</DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required defaultValue={vendor.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" name="address" defaultValue={vendor.address ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input id="gstin" name="gstin" defaultValue={vendor.gstin ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={vendor.phone ?? ""} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={vendor.email ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" name="note" defaultValue={vendor.note ?? ""} />
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
