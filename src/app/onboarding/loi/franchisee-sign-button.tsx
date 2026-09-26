"use client";

import { useState } from "react";
import { startFranchiseeEsign } from "./actions";
import { Button } from "@/components/ui/button";
import type { EsignAttemptStatus } from "@prisma/client";

export function FranchiseeSignButton({
  onboardingId,
  canSign,
  attemptStatus,
}: {
  onboardingId: string;
  canSign: boolean;
  attemptStatus: EsignAttemptStatus | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (attemptStatus === "SENT" || attemptStatus === "IN_PROGRESS") {
    return <p className="text-sm text-muted-foreground">Signing in progress — check back shortly.</p>;
  }
  if (attemptStatus === "COMPLETED") {
    return <p className="text-sm text-emerald-600">You&apos;ve signed — waiting on the company signatory.</p>;
  }

  async function handleClick() {
    setPending(true);
    setError(null);
    const result = await startFranchiseeEsign(onboardingId);
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
      <Button
        onClick={handleClick}
        disabled={!canSign || pending}
        title={canSign ? undefined : "Complete KYC, payment and LOI release first"}
      >
        {pending ? "Starting…" : "Proceed to Aadhaar e-sign"}
      </Button>
    </div>
  );
}
