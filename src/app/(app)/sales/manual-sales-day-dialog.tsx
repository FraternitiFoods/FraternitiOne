"use client";

import { useActionState, useState } from "react";
import { upsertSalesDay, type ActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type ExistingDay = {
  date: string; // YYYY-MM-DD
  grossSalesRupees: string;
  netSalesRupees: string;
  orders: number;
};

/**
 * One dialog handles both "Add a day" (no `existingDay`) and "Edit this day"
 * (prefilled) — same upsert action either way (section 20A SRD 10.2
 * fallback). Admin-only; the page only renders the trigger for
 * `canManageSales(user)`.
 */
export function ManualSalesDayDialog({
  projectId,
  redirectTo,
  existingDay,
  triggerLabel,
  triggerVariant = "default",
  triggerSize = "default",
}: {
  projectId: string;
  redirectTo: string;
  existingDay?: ExistingDay;
  triggerLabel: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
  triggerSize?: React.ComponentProps<typeof Button>["size"];
}) {
  const [open, setOpen] = useState(false);
  const boundAction = upsertSalesDay.bind(null, projectId, redirectTo);
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
      <Button variant={triggerVariant} size={triggerSize} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existingDay ? "Edit sales day" : "Add a sales day"}</DialogTitle>
          <DialogDescription>
            Revenue only — gross, net and order count for one store-day (SRD 10.2 manual fallback).
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sales-date">Date</Label>
            <Input
              id="sales-date"
              name="date"
              type="date"
              required
              defaultValue={existingDay?.date}
              max={new Date().toISOString().slice(0, 10)}
              readOnly={Boolean(existingDay)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sales-gross">Gross sales (₹)</Label>
              <Input
                id="sales-gross"
                name="grossSales"
                type="text"
                inputMode="decimal"
                required
                defaultValue={existingDay?.grossSalesRupees}
                placeholder="e.g. 45000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sales-net">Net sales (₹)</Label>
              <Input
                id="sales-net"
                name="netSales"
                type="text"
                inputMode="decimal"
                required
                defaultValue={existingDay?.netSalesRupees}
                placeholder="e.g. 42000"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sales-orders">Orders</Label>
            <Input
              id="sales-orders"
              name="orders"
              type="text"
              inputMode="numeric"
              required
              defaultValue={existingDay ? String(existingDay.orders) : undefined}
              placeholder="e.g. 180"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Amounts are in rupees — stored as paise. Net sales can&rsquo;t exceed gross, future dates aren&rsquo;t
            allowed.
          </p>

          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : existingDay ? "Save changes" : "Add day"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
