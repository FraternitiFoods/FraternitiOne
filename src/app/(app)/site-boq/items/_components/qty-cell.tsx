"use client";

import { useActionState, useRef } from "react";
import { updateSiteItemQty, type ActionState } from "../actions";
import { cn } from "cn";

/**
 * plan.md section 4.3 "inline qty edit". Qty and remark/size are separate
 * single-input forms (see actions.ts) so each is its own `<td>`-local
 * `<form>` — an HTML table can't have one `<form>` spanning two cells.
 * Submits on blur, only if the value actually changed, so clicking in and
 * back out doesn't write a no-op audit event.
 */
export function QtyCell({
  siteId,
  itemId,
  qty,
  missingRate,
  editable,
  locked,
}: {
  siteId: string;
  itemId: string;
  qty: number;
  missingRate: boolean;
  editable: boolean;
  /** Site is locked (plan.md section 3) — shows a "Site is locked" tooltip on the read-only value; the server guard already rejects the write either way. */
  locked?: boolean;
}) {
  const boundAction = updateSiteItemQty.bind(null, siteId, itemId);
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const lastSaved = useRef(qty);

  if (!editable) {
    return (
      <span
        title={locked ? "Site is locked" : undefined}
        className={missingRate ? "font-medium text-destructive" : undefined}
      >
        {qty}
      </span>
    );
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col items-end gap-0.5">
      <input
        type="number"
        name="qty"
        min={0}
        step="0.01"
        defaultValue={qty}
        disabled={pending}
        aria-label="Qty"
        onBlur={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next) && next !== lastSaved.current) {
            lastSaved.current = next;
            formRef.current?.requestSubmit();
          }
        }}
        className={cn(
          "h-7 w-20 rounded-md border border-input bg-transparent px-1.5 text-right text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
          missingRate && "font-medium text-destructive"
        )}
      />
      {state?.error && <span className="text-[10px] text-destructive">{state.error}</span>}
    </form>
  );
}
