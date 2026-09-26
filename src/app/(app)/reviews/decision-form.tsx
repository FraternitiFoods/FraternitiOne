"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReviewActionState } from "./actions";

type FormAction = (state: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;

/**
 * Shared Accept / Request-changes form for both the KYC and Payment review
 * detail pages (P1-13: a reason is mandatory when requesting changes).
 *
 * Deliberately NOT `<form action={formAction}>` with two submit buttons —
 * a real Playwright run showed the server action receiving no `decision`
 * field at all no matter how it was carried (submit-button name/value, a
 * ref-mutated hidden input), which points at Base UI's Button/click timing
 * interacting badly with React 19's native multi-submitter form handling
 * here, not a fixable prop. Sidestepping that entirely: each button's
 * onClick builds a plain FormData object itself and calls the bound server
 * action function directly (same "call the server function, handle the
 * result" shape as payment-section.tsx and upload-flow.tsx elsewhere in
 * this app), managing pending/error state locally instead of via
 * useActionState.
 */
export function DecisionForm({
  action,
  acceptLabel,
  rejectLabel,
  requireAmountOnAccept,
  backHref,
}: {
  action: FormAction;
  acceptLabel: string;
  rejectLabel: string;
  requireAmountOnAccept?: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const bankRefRef = useRef<HTMLInputElement>(null);

  async function submit(decision: "ACCEPT" | "REQUEST_CHANGES") {
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("decision", decision);
    formData.set("reason", reasonRef.current?.value ?? "");
    if (requireAmountOnAccept) {
      formData.set("verifiedAmountRupees", amountRef.current?.value ?? "");
      formData.set("bankReference", bankRefRef.current?.value ?? "");
    }
    const result = await action(undefined, formData);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.push(backHref);
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      {requireAmountOnAccept && (
        <div className="space-y-2">
          <Label htmlFor="verifiedAmountRupees">Verified amount — required when accepting (₹)</Label>
          <Input id="verifiedAmountRupees" ref={amountRef} type="number" min="1" />
          <Label htmlFor="bankReference">Bank reference (optional)</Label>
          <Input id="bankReference" ref={bankRefRef} />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="reason">Reason — required when requesting changes</Label>
        <Textarea id="reason" ref={reasonRef} />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => submit("ACCEPT")}>
          {pending ? "Submitting…" : acceptLabel}
        </Button>
        <Button variant="destructive" disabled={pending} onClick={() => submit("REQUEST_CHANGES")}>
          {pending ? "Submitting…" : rejectLabel}
        </Button>
      </div>
    </div>
  );
}
