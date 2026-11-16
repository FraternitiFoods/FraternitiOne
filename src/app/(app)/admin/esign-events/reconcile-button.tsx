"use client";

import { useState } from "react";
import { reconcileAttempt } from "./actions";
import { Button } from "@/components/ui/button";

export function ReconcileButton({ attemptId }: { attemptId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    const result = await reconcileAttempt(attemptId);
    setPending(false);
    setMessage(result.error ?? result.outcome ?? null);
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={handleClick}>
        {pending ? "Reconciling…" : "Reconcile"}
      </Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
