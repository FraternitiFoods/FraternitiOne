"use client";

import { useActionState, useState } from "react";
import { updateOutletMapping, type ActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * plan.md section 26 `/admin/pos` outlet mapping — same "one dialog, bound
 * action, close on success" shape as `ManualSalesDayDialog` (section 20A).
 */
export function OutletMappingDialog({
  projectId,
  storeLabel,
  petpoojaRestId,
  posLiveFrom,
}: {
  projectId: string;
  storeLabel: string;
  petpoojaRestId: string | null;
  posLiveFrom: string | null; // YYYY-MM-DD
}) {
  const [open, setOpen] = useState(false);
  const boundAction = updateOutletMapping.bind(null, projectId);
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);

  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (wasPending && !pending && !state?.error) {
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
        {petpoojaRestId ? "Edit" : "Map outlet"}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Map Petpooja outlet</DialogTitle>
          <DialogDescription>{storeLabel}</DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pos-rest-id">Petpooja restID</Label>
            <Input
              id="pos-rest-id"
              name="petpoojaRestId"
              type="text"
              defaultValue={petpoojaRestId ?? ""}
              placeholder="e.g. cp81ghin"
            />
            <p className="text-xs text-muted-foreground">Leave blank to unmap this store from Petpooja.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pos-live-from">Go-live date (IST)</Label>
            <Input id="pos-live-from" name="posLiveFrom" type="date" defaultValue={posLiveFrom ?? ""} />
            <p className="text-xs text-muted-foreground">
              Bills before this date are still stored but don&rsquo;t touch /sales totals — history before go-live
              stays on CSV import.
            </p>
          </div>

          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
