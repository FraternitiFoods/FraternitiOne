"use client";

import { useActionState, useRef } from "react";
import { updateSiteItemRemark, type ActionState } from "../actions";

/** plan.md section 4.3 "inline remark/size edit". See QtyCell for the submit-on-change-blur pattern. */
export function RemarkCell({
  siteId,
  itemId,
  remarkSize,
  editable,
  locked,
}: {
  siteId: string;
  itemId: string;
  remarkSize: string | null;
  editable: boolean;
  /** Site is locked (plan.md section 3) — shows a "Site is locked" tooltip on the read-only value; the server guard already rejects the write either way. */
  locked?: boolean;
}) {
  const boundAction = updateSiteItemRemark.bind(null, siteId, itemId);
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const lastSaved = useRef(remarkSize ?? "");

  if (!editable) {
    return <span title={locked ? "Site is locked" : undefined}>{remarkSize || "—"}</span>;
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-0.5">
      <input
        type="text"
        name="remarkSize"
        defaultValue={remarkSize ?? ""}
        disabled={pending}
        placeholder="—"
        aria-label="Remark / size"
        onBlur={(e) => {
          const next = e.target.value;
          if (next !== lastSaved.current) {
            lastSaved.current = next;
            formRef.current?.requestSubmit();
          }
        }}
        className="h-7 w-full min-w-24 rounded-md border border-input bg-transparent px-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      {state?.error && <span className="text-[10px] text-destructive">{state.error}</span>}
    </form>
  );
}
