"use client";

import { cloneElement, useActionState, useState, type ReactElement } from "react";
import { createItem, updateItem, type ActionState } from "../actions";
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

type CategoryVendor = { id: string; name: string };

export type EditableItem = {
  id: string;
  name: string;
  sizeNote: string | null;
  note: string | null;
  finalVendorId: string | null;
  rates: Record<string, number | null>;
};

/**
 * plan.md section 4.3 "Admin can add an item (name, vendor rates, final
 * vendor)" — one dialog for both add and edit (item prop present = edit).
 * Photo upload is out of scope here (milestone M4; B2 credentials still
 * blank per plan.md section 9).
 *
 * Split into an outer (owns `open` + a remount counter) and inner (owns
 * `useActionState` + the Dialog) component: the inner one remounts fresh
 * every time it's opened (via `key`), so it can derive
 * `open={open && !state?.success}` to auto-close on a successful save
 * without a setState-in-effect, and never gets stuck closed by a stale
 * `success` from a previous save the way a plain `useEffect` close would.
 */
export function ItemFormDialog({
  categoryId,
  categoryVendors,
  item,
  trigger,
}: {
  categoryId: string;
  categoryVendors: CategoryVendor[];
  item?: EditableItem;
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
      <ItemFormDialogContent
        key={instanceKey}
        open={open}
        onOpenChange={setOpen}
        categoryId={categoryId}
        categoryVendors={categoryVendors}
        item={item}
      />
    </>
  );
}

function ItemFormDialogContent({
  open,
  onOpenChange,
  categoryId,
  categoryVendors,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string;
  categoryVendors: CategoryVendor[];
  item?: EditableItem;
}) {
  const isEdit = Boolean(item);
  const boundAction = isEdit ? updateItem.bind(null, item!.id) : createItem;
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);
  const dialogOpen = open && !state?.success;

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${item!.name}` : "Add item"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Name, size note, vendor rates and final vendor."
              : "Creates a new item in this category with its vendor rates and final vendor."}
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          {!isEdit && <input type="hidden" name="categoryId" value={categoryId} />}

          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required defaultValue={item?.name} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sizeNote">Size note</Label>
              <Input id="sizeNote" name="sizeNote" defaultValue={item?.sizeNote ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="finalVendorId">Final vendor</Label>
              <select
                id="finalVendorId"
                name="finalVendorId"
                defaultValue={item?.finalVendorId ?? ""}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="">No final vendor yet</option>
                {categoryVendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" name="note" defaultValue={item?.note ?? ""} />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Vendor rates</p>
            {categoryVendors.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No vendors are linked to this category yet — add them from the Vendors screen first.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {categoryVendors.map((v) => (
                <div key={v.id} className="space-y-1.5">
                  <Label htmlFor={`rate_${v.id}`}>{v.name}</Label>
                  <Input
                    id={`rate_${v.id}`}
                    name={`rate_${v.id}`}
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={item?.rates[v.id] ?? ""}
                  />
                </div>
              ))}
            </div>
          </div>

          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save changes" : "Create item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
