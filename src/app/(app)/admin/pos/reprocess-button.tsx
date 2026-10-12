"use client";

import { useState } from "react";
import { reprocessEvent } from "./actions";
import { Button } from "@/components/ui/button";

/** Same shape as the e-sign events page's `ReconcileButton`. */
export function ReprocessButton({ eventId }: { eventId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    const result = await reprocessEvent(eventId);
    setPending(false);
    setMessage(result.error ?? result.outcome ?? null);
  }

  return (
    <div className="space-y-1">
      <Button size="xs" variant="outline" disabled={pending} onClick={handleClick}>
        {pending ? "Reprocessing…" : "Reprocess"}
      </Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
