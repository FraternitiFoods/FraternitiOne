"use client";

import { useState } from "react";
import { startCompanyEsign } from "../actions";
import { Button } from "@/components/ui/button";

export function CompanySignButton({ onboardingId, canSign }: { onboardingId: string; canSign: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    const result = await startCompanyEsign(onboardingId);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    window.location.href = result.signingUrl;
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button onClick={handleClick} disabled={!canSign || pending}>
        {pending ? "Starting…" : "Countersign (Aadhaar e-sign)"}
      </Button>
    </div>
  );
}
