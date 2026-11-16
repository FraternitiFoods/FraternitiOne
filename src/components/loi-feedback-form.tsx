"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** "Don't want to sign yet? Tell us why" — a plain-text note to the sales owner / LOI preparer / Admin, logged to AuditEvent, emailed to them. */
export function LoiFeedbackForm({
  onboardingId,
  submitAction,
}: {
  onboardingId: string;
  submitAction: (onboardingId: string, message: string) => Promise<{ error: string } | { ok: true }>;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return <p className="text-sm text-emerald-600">Sent to the team — they&apos;ll follow up with you.</p>;
  }

  if (!open) {
    return (
      <button type="button" className="text-sm text-muted-foreground underline underline-offset-4" onClick={() => setOpen(true)}>
        Have concerns, or not ready to sign? Leave a note for the team
      </button>
    );
  }

  async function handleSubmit() {
    setPending(true);
    setError(null);
    const result = await submitAction(onboardingId, message);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSent(true);
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">Not ready to sign, or have a question about the LOI?</p>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="e.g. the territory/fee doesn't match what we discussed, or I need more time..."
        rows={3}
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" onClick={handleSubmit} disabled={pending || !message.trim()}>
          {pending ? "Sending…" : "Send to the team"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
