"use client";

import { useActionState, useState } from "react";
import { cn } from "cn";
import { updateSiteItemTracking, updateSiteItemRateOverride, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";

export type TrackingFields = {
  poAmount: number | null;
  boqLink: string | null;
  poLink: string | null;
  approvedVia: string | null;
  link: string | null;
  advanceGiven: number | null;
  stage: string | null;
  followUp: string | null;
  remarks: string | null;
};

/**
 * plan.md section 4.3's "per-row drawer for the tracking fields" — built on
 * the existing Dialog primitive (no separate slide-out "drawer" component
 * exists in this repo yet; reusing Dialog keeps this on the established UI
 * convention rather than introducing a second modal pattern). Always
 * rendered so any internal role can at least *view* a site's order-tracking
 * state; inputs are disabled and there's no Save button when `editable` is
 * false (SHEET_LIVE, a locked site, or an external role never reaching this
 * page at all).
 *
 * Split into an outer/inner pair — see item-form-dialog.tsx's comment for
 * why: the inner component remounts fresh on every open so it can derive
 * `open={open && !state?.success}` and auto-close on a successful save
 * without a setState-in-effect.
 */
export function TrackingDrawer(props: {
  siteId: string;
  itemId: string;
  itemName: string;
  siteName: string;
  tracking: TrackingFields;
  editable: boolean;
  /** Site is locked (plan.md section 3) — tracking fields AND the rate override both become read-only, with a "Site is locked" tooltip. */
  locked: boolean;
  /** Current per-site rate override, independent of whether it's in effect (a locked site ignores it) — plan.md section 3/5, built this session. */
  rateOverride: number | null;
  /** The item's catalog final rate, shown as context next to the override field. */
  finalRate: number | null;
  /** Admin + WEBSITE_LIVE + not locked (section 5: rate_override edit is Admin-only, unlike qty/remark/tracking). */
  rateOverrideEditable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [instanceKey, setInstanceKey] = useState(0);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setInstanceKey((k) => k + 1);
          setOpen(true);
        }}
      >
        Tracking
      </Button>
      <TrackingDrawerContent key={instanceKey} open={open} onOpenChange={setOpen} {...props} />
    </>
  );
}

function TrackingDrawerContent({
  open,
  onOpenChange,
  siteId,
  itemId,
  itemName,
  siteName,
  tracking,
  editable,
  locked,
  rateOverride,
  finalRate,
  rateOverrideEditable,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  itemId: string;
  itemName: string;
  siteName: string;
  tracking: TrackingFields;
  editable: boolean;
  locked: boolean;
  rateOverride: number | null;
  finalRate: number | null;
  rateOverrideEditable: boolean;
}) {
  const boundAction = updateSiteItemTracking.bind(null, siteId, itemId);
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);

  const boundOverrideAction = updateSiteItemRateOverride.bind(null, siteId, itemId);
  const [overrideState, overrideAction, overridePending] = useActionState<ActionState, FormData>(
    boundOverrideAction,
    undefined
  );

  const dialogOpen = open && !state?.success && !overrideState?.success;
  const lockTooltip = locked ? "Site is locked" : undefined;

  const pendingAmount =
    tracking.poAmount === null && tracking.advanceGiven === null
      ? null
      : (tracking.poAmount ?? 0) - (tracking.advanceGiven ?? 0);

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Order tracking — {itemName}</DialogTitle>
          <DialogDescription>{siteName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 rounded-lg bg-muted p-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="rateOverride">
              Rate override (this site)
              {rateOverride !== null && <Badge variant="outline" className="ml-2 align-middle">Overridden</Badge>}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Final rate: {finalRate !== null ? formatCurrency(finalRate, 2) : "No rate"}. Leave blank to use it as-is.
          </p>
          <form action={overrideAction} className="flex items-center gap-2">
            <Input
              id="rateOverride"
              name="rateOverride"
              type="number"
              step="0.01"
              min={0}
              defaultValue={rateOverride ?? ""}
              placeholder="No override"
              disabled={!rateOverrideEditable || overridePending}
              title={lockTooltip}
              className="w-32"
            />
            {rateOverrideEditable && (
              <Button type="submit" size="sm" disabled={overridePending}>
                {overridePending ? "Saving…" : "Save"}
              </Button>
            )}
          </form>
          {overrideState?.error && (
            <p className="text-sm text-destructive" role="alert">
              {overrideState.error}
            </p>
          )}
        </div>

        <form action={action} className="grid grid-cols-2 gap-3">
          <Field label="Stage" name="stage" defaultValue={tracking.stage} disabled={!editable || pending} title={lockTooltip} />
          <Field
            label="Follow-up"
            name="followUp"
            defaultValue={tracking.followUp}
            disabled={!editable || pending}
            title={lockTooltip}
          />
          <Field
            label="PO amount"
            name="poAmount"
            type="number"
            defaultValue={tracking.poAmount}
            disabled={!editable || pending}
            title={lockTooltip}
          />
          <Field
            label="Advance given"
            name="advanceGiven"
            type="number"
            defaultValue={tracking.advanceGiven}
            disabled={!editable || pending}
            title={lockTooltip}
          />

          <p className="col-span-2 text-xs text-muted-foreground">
            Pending: <span className="font-medium text-foreground">{pendingAmount !== null ? formatCurrency(pendingAmount, 2) : "—"}</span>{" "}
            — computed from PO amount − advance given, not directly editable.
          </p>

          <Field
            label="BOQ link"
            name="boqLink"
            defaultValue={tracking.boqLink}
            disabled={!editable || pending}
            title={lockTooltip}
            className="col-span-2"
          />
          <Field
            label="PO link"
            name="poLink"
            defaultValue={tracking.poLink}
            disabled={!editable || pending}
            title={lockTooltip}
            className="col-span-2"
          />
          <Field
            label="Approved via"
            name="approvedVia"
            defaultValue={tracking.approvedVia}
            disabled={!editable || pending}
            title={lockTooltip}
            className="col-span-2"
          />
          <Field
            label="Link"
            name="link"
            defaultValue={tracking.link}
            disabled={!editable || pending}
            title={lockTooltip}
            className="col-span-2"
          />

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="remarks">Remarks</Label>
            <Textarea
              id="remarks"
              name="remarks"
              defaultValue={tracking.remarks ?? ""}
              disabled={!editable || pending}
              title={lockTooltip}
            />
          </div>

          {state?.error && (
            <p className="col-span-2 text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <DialogFooter className="col-span-2">
            <DialogClose render={<Button type="button" variant="outline" />}>Close</DialogClose>
            {editable && (
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  defaultValue,
  disabled,
  type = "text",
  className,
  title,
}: {
  label: string;
  name: string;
  defaultValue: string | number | null;
  disabled: boolean;
  type?: string;
  className?: string;
  title?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue ?? ""} disabled={disabled} title={title} />
    </div>
  );
}
