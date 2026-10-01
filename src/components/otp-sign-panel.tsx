"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * plan.md section 19 "What gets built" #8 — shared by both signer roles
 * (/onboarding/loi for the franchisee, /signing/[id] for the company
 * signatory): open preview (handled by the page's existing "Preview LOI"
 * link, outside this component) → consent box → Send OTP → code input with
 * masked number, resend timer and attempts left → success.
 *
 * The spec describes a "6-box code input" — built here as one labeled,
 * numeric, wide-letter-spaced text field rather than six auto-advancing
 * boxes: same visual effect, far more robust for screen readers, mobile
 * keyboards, and automated testing (one `fill()` instead of coordinating
 * six focus-jumps), and still exactly 6 digits enforced both client- and
 * server-side.
 */

type RequestResult = { error: string } | { ok: true; phoneMasked: string; expiresAt: string };
type VerifyResult = { error: string; locked?: boolean } | { ok: true };

const RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

export function OtpSignPanel({
  onboardingId,
  canSign,
  initiallySent,
  consentText,
  phoneMasked,
  buttonLabel,
  requestAction,
  verifyAction,
}: {
  onboardingId: string;
  canSign: boolean;
  /** True if a request already put this signer's attempt in SENT state (e.g. the page was reloaded mid-flow). */
  initiallySent: boolean;
  consentText: string;
  /** Masked phone shown even before the first send, per decision 5: "shown masked ... cannot edit it on this screen." */
  phoneMasked: string;
  buttonLabel: string;
  requestAction: (onboardingId: string, consentAccepted: boolean) => Promise<RequestResult>;
  verifyAction: (onboardingId: string, code: string, consentAccepted: boolean) => Promise<VerifyResult>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"consent" | "code">(initiallySent ? "code" : "consent");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [code, setCode] = useState("");
  const [sentPhoneMasked, setSentPhoneMasked] = useState(phoneMasked);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(OTP_MAX_ATTEMPTS);
  // Starts null even when initiallySent (a page reload mid-flow) — the
  // server (evaluateOtpSend, via lastSentAt) is the real cooldown enforcer
  // regardless of what this button shows; this is request-driven display
  // only, set inside the event handlers below, never during render.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => setCooldownSeconds(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  async function handleSend() {
    setPending(true);
    setError(null);
    const result = await requestAction(onboardingId, consentAccepted);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSentPhoneMasked(result.phoneMasked);
    setStep("code");
    setCode("");
    setLocked(false);
    setAttemptsLeft(OTP_MAX_ATTEMPTS);
    setCooldownUntil(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
  }

  async function handleVerify() {
    setPending(true);
    setError(null);
    const result = await verifyAction(onboardingId, code, consentAccepted);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      if (result.locked) setLocked(true);
      else setAttemptsLeft((n) => Math.max(0, n - 1));
      return;
    }
    router.refresh();
  }

  if (step === "consent") {
    return (
      <div className="space-y-3">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <p className="text-xs font-medium text-destructive">PLACEHOLDER — NOT APPROVED LEGAL TEXT</p>
        <p className="rounded-md border bg-muted/40 p-3 text-sm">{consentText}</p>
        <p className="text-sm text-muted-foreground">A one-time code will be sent by SMS to {phoneMasked}.</p>
        <p className="text-xs text-muted-foreground">
          This is a simple SMS one-time-code acceptance, not an Aadhaar e-sign — a weaker form of electronic
          signature. It is recorded as &quot;authenticated accept with proof,&quot; not a digital signature.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={consentAccepted}
            onChange={(e) => setConsentAccepted(e.target.checked)}
          />
          I have read the LOI and agree to its terms.
        </label>
        <Button onClick={handleSend} disabled={!canSign || !consentAccepted || pending}>
          {pending ? "Sending…" : buttonLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <p className="text-sm text-muted-foreground">Code sent to {sentPhoneMasked}. Valid for 10 minutes.</p>
      <div className="space-y-1">
        <Label htmlFor="otp-code">Enter the 6-digit code</Label>
        <Input
          id="otp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="w-40 text-center text-2xl tracking-[0.5em]"
          value={code}
          disabled={locked}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </div>
      {!locked && <p className="text-xs text-muted-foreground">{attemptsLeft} attempt(s) left.</p>}
      <div className="flex items-center gap-3">
        <Button onClick={handleVerify} disabled={locked || code.length !== 6 || pending}>
          {pending ? "Verifying…" : "Verify"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleSend}
          disabled={pending || cooldownSeconds > 0}
        >
          {cooldownSeconds > 0 ? `Resend in ${cooldownSeconds}s` : "Resend code"}
        </Button>
      </div>
    </div>
  );
}
