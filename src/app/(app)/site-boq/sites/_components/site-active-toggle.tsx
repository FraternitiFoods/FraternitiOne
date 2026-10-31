"use client";

import { useActionState } from "react";
import { setSiteActive, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";

/** plan.md section 4.6 "hide" — same soft show/hide pattern as users/deactivate-user-button.tsx. */
export function SiteActiveToggle({ siteId, isActive }: { siteId: string; isActive: boolean }) {
  const boundAction = setSiteActive.bind(null, siteId, !isActive);
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);

  return (
    <form action={action}>
      <Button type="submit" variant="ghost" size="sm" disabled={pending} className="h-7 px-2 text-xs">
        {pending ? (isActive ? "Hiding…" : "Showing…") : isActive ? "Hide" : "Show"}
      </Button>
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
