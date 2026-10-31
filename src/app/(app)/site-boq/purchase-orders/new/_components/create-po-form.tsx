"use client";

import { useActionState } from "react";
import { createPurchaseOrders, type ActionState } from "../../actions";
import { Button } from "@/components/ui/button";

/**
 * The actual mutation — separate from the GET "Update preview" form above it
 * on the page, so changing a selector never accidentally creates a PO.
 * Resubmits the exact same selection the preview above was computed from,
 * as hidden fields; createPurchaseOrders recomputes lines/totals server-side
 * from that selection rather than trusting anything the preview rendered.
 */
export function CreatePoForm({
  siteId,
  categoryId,
  vendorIds,
  poDate,
  deliveryDays,
  gstPercent,
  paymentTerms,
  disabled,
}: {
  siteId: string;
  categoryId: string;
  vendorIds: string[];
  poDate: string;
  deliveryDays: number;
  gstPercent: number;
  paymentTerms: string;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createPurchaseOrders, undefined);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="categoryId" value={categoryId} />
      {vendorIds.map((id) => (
        <input key={id} type="hidden" name="vendor" value={id} />
      ))}
      <input type="hidden" name="poDate" value={poDate} />
      <input type="hidden" name="deliveryDays" value={deliveryDays} />
      <input type="hidden" name="gstPercent" value={gstPercent} />
      <input type="hidden" name="paymentTerms" value={paymentTerms} />

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={disabled || pending}>
        {pending ? "Creating…" : "Create PO(s)"}
      </Button>
    </form>
  );
}
