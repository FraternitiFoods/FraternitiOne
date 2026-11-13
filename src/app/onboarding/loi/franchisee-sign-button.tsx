"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const [agreed, setAgreed] = useState(false);
  const router = useRouter();

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
    if (result.autoCompleted) {
      window.alert("You have esigned!!");
      router.refresh();
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
      {canSign && (
        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          I agree to the terms and conditions of the LOI
        </label>
      )}
      <Button
        onClick={handleClick}
        disabled={!canSign || !agreed || pending}
        title={canSign ? (agreed ? undefined : "Agree to the LOI terms and conditions first") : "Complete KYC, payment and LOI release first"}
      >
        {pending ? "Starting…" : "Proceed to Aadhaar e-sign"}
      </Button>
    </div>
  );
}
