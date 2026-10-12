"use client";

import { useState } from "react";
import { unpinSalesDay } from "./actions";
import { Button } from "@/components/ui/button";

/** plan.md section 26 "Pinning": "'Unpin and recompute' is an Admin action." */
export function UnpinButton({ salesDayId }: { salesDayId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    const result = await unpinSalesDay(salesDayId);
    setPending(false);
    setError(result?.error ?? null);
  }

  return (
    <div className="space-y-1">
      <Button size="xs" variant="outline" disabled={pending} onClick={handleClick}>
        {pending ? "Unpinning…" : "Unpin & recompute"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
