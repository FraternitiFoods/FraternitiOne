"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPresignedOnboardingUpload, submitPaymentReceipt } from "./actions";
import { formatMoney } from "@/lib/onboarding/format";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ObButton } from "@/components/onboarding-ui/buttons";
import { OB_FILE_INPUT_CLASS, OB_INPUT_CLASS, OB_LABEL_CLASS } from "@/components/onboarding-ui/form-styles";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

type LatestPayment = { declaredAmount: number; mode: string; utr: string; paymentDate: string };

export function PaymentSection({
  expectedAmount,
  totalVerifiedAmount,
  latestPayment,
  editable,
}: {
  expectedAmount: number;
  totalVerifiedAmount: number;
  latestPayment: LatestPayment | null;
  editable: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const remainingAmount = expectedAmount - totalVerifiedAmount;
  const [declaredAmountRupees, setDeclaredAmountRupees] = useState(
    String((remainingAmount > 0 ? remainingAmount : expectedAmount) / 100)
  );
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
    } catch (err) {
      console.error("[Payment receipt upload] failed:", err);
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[15px] text-[var(--ob-text-2)]">LOI fee amount: {formatMoney(expectedAmount)}</p>
      {totalVerifiedAmount > 0 && (
        <p className="text-[15px] text-[var(--ob-text-2)]">
          Verified so far: {formatMoney(totalVerifiedAmount)}
          {remainingAmount > 0 && <> — {formatMoney(remainingAmount)} remaining</>}
        </p>
      )}

      {latestPayment && (
        <div className="rounded-[20px] border border-[var(--ob-line)] bg-[var(--ob-bg)] px-5 py-4 text-[15px] text-[var(--ob-text-2)]">
          <div>Declared: {formatMoney(latestPayment.declaredAmount)}</div>
          <div>Mode: {latestPayment.mode}</div>
          <div>UTR: {latestPayment.utr}</div>
        </div>
      )}

      {editable && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className={OB_LABEL_CLASS} htmlFor="declaredAmountRupees">Amount paid (₹)</Label>
              <Input
                className={OB_INPUT_CLASS}
                id="declaredAmountRupees"
                type="number"
                min="1"
                value={declaredAmountRupees}
                onChange={(e) => setDeclaredAmountRupees(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className={OB_LABEL_CLASS} htmlFor="paymentDate">Payment date</Label>
              <Input
                className={OB_INPUT_CLASS}
                id="paymentDate"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className={OB_LABEL_CLASS} htmlFor="mode">Payment mode</Label>
              <Input
                className={OB_INPUT_CLASS}
                id="mode"
                placeholder="NEFT / RTGS / UPI"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className={OB_LABEL_CLASS} htmlFor="utr">UTR / transaction reference</Label>
              <Input className={OB_INPUT_CLASS} id="utr" value={utr} onChange={(e) => setUtr(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label className={OB_LABEL_CLASS} htmlFor="receipt">Receipt file (PDF, JPG or PNG, max 10MB)</Label>
            <input
              ref={fileInputRef}
              id="receipt"
              type="file"
              className={OB_FILE_INPUT_CLASS}
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
            <p className="text-sm font-medium text-[#8a1c14]" role="alert">
              {error}
            </p>
          )}

          <ObButton variant="solid" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit payment receipt"}
          </ObButton>
        </div>
      )}
    </div>
  );
}
