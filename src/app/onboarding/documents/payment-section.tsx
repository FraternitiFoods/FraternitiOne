"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPresignedOnboardingUpload, submitPaymentReceipt } from "./actions";
import { formatMoney } from "@/lib/onboarding/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

type LatestPayment = { declaredAmount: number; mode: string; utr: string; paymentDate: string };

export function PaymentSection({
  expectedAmount,
  latestPayment,
  editable,
}: {
  expectedAmount: number;
  latestPayment: LatestPayment | null;
  editable: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [declaredAmountRupees, setDeclaredAmountRupees] = useState(String(expectedAmount / 100));
  const [paymentDate, setPaymentDate] = useState("");
  const [mode, setMode] = useState("");
  const [utr, setUtr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!file) {
      setError("Attach the payment receipt.");
      return;
    }
    if (!paymentDate || !mode || !utr) {
      setError("Payment date, mode and UTR are required.");
      return;
    }
    setSubmitting(true);
    try {
      const presign = await getPresignedOnboardingUpload({
        kind: "PAYMENT_RECEIPT",
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      });
      if ("error" in presign) {
        setError(presign.error);
        return;
      }
      const put = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) {
        setError("Upload to storage failed. Try again.");
        return;
      }
      const result = await submitPaymentReceipt({
        key: presign.key,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
        declaredAmountRupees: Number(declaredAmountRupees),
        paymentDate,
        mode,
        utr,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">LOI fee amount: {formatMoney(expectedAmount)}</p>

      {latestPayment && (
        <div className="rounded-md border p-3 text-sm">
          <div>Declared: {formatMoney(latestPayment.declaredAmount)}</div>
          <div>Mode: {latestPayment.mode}</div>
          <div>UTR: {latestPayment.utr}</div>
        </div>
      )}

      {editable && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="declaredAmountRupees">Amount paid (₹)</Label>
              <Input
                id="declaredAmountRupees"
                type="number"
                min="1"
                value={declaredAmountRupees}
                onChange={(e) => setDeclaredAmountRupees(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentDate">Payment date</Label>
              <Input
                id="paymentDate"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mode">Payment mode</Label>
              <Input
                id="mode"
                placeholder="NEFT / RTGS / UPI"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="utr">UTR / transaction reference</Label>
              <Input id="utr" value={utr} onChange={(e) => setUtr(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="receipt">Receipt file (PDF, JPG or PNG, max 10MB)</Label>
            <input
              ref={fileInputRef}
              id="receipt"
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > MAX_UPLOAD_BYTES) {
                  setError("File is too large (max 10MB).");
                  return;
                }
                if (!ACCEPTED_TYPES.includes(f.type)) {
                  setError("Only PDF, JPG or PNG files are accepted.");
                  return;
                }
                setError(null);
                setFile(f);
              }}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit payment receipt"}
          </Button>
        </div>
      )}
    </div>
  );
}
