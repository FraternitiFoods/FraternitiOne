"use client";

import { useActionState } from "react";
import { resendInvite, type ResendInviteState } from "./actions";
import { Button } from "@/components/ui/button";

export function ResendInviteButton({ userId }: { userId: string }) {
  const boundAction = resendInvite.bind(null, userId);
  const [state, action, pending] = useActionState<ResendInviteState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={action}>
      <Button type="submit" variant="ghost" size="sm" disabled={pending} className="h-7 px-2 text-xs">
        {pending ? "Sending…" : state?.success ? "Sent" : "Resend invite"}
      </Button>
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
