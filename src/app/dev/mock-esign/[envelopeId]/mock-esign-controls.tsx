"use client";

import { useState } from "react";
import { triggerMockWebhook } from "./actions";
import { Button } from "@/components/ui/button";

export function MockEsignControls({ envelopeId }: { envelopeId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function fire(result: "COMPLETED" | "FAILED" | "EXPIRED") {
    setPending(true);
    const res = await triggerMockWebhook(envelopeId, result);
    setPending(false);
    if (res.eventId) setLastEventId(res.eventId);
    setStatus(res.error ? `Error: ${res.error}` : `Webhook sent: ${result}`);
  }

  async function fireDuplicate() {
    if (!lastEventId) {
      setStatus("Complete once first, then use Send duplicate.");
      return;
    }
    setPending(true);
    const res = await triggerMockWebhook(envelopeId, "COMPLETED", { duplicateOfEventId: lastEventId });
    setPending(false);
    setStatus(res.error ? `Error: ${res.error}` : "Duplicate webhook sent (should be a no-op).");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => fire("COMPLETED")}>
          Complete
        </Button>
        <Button disabled={pending} variant="destructive" onClick={() => fire("FAILED")}>
          Fail
        </Button>
        <Button disabled={pending} variant="outline" onClick={() => fire("EXPIRED")}>
          Expire
        </Button>
      </div>
      <Button disabled={pending} variant="ghost" size="sm" onClick={fireDuplicate}>
        Send duplicate (idempotency test)
      </Button>
      {status && <p className="text-sm text-muted-foreground">{status}</p>}
    </div>
  );
}
