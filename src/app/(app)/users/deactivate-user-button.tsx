"use client";

import { useActionState } from "react";
import { setUserActive, type SetUserActiveState } from "./actions";
import { Button } from "@/components/ui/button";

export function DeactivateUserButton({ userId, isActive }: { userId: string; isActive: boolean }) {
  const boundAction = setUserActive.bind(null, userId, !isActive);
  const [state, action, pending] = useActionState<SetUserActiveState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={action}>
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        className="h-7 px-2 text-xs"
      >
        {pending ? (isActive ? "Deactivating…" : "Reactivating…") : isActive ? "Deactivate" : "Reactivate"}
      </Button>
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
