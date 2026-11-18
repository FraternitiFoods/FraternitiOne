"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getPresignedOnboardingUpload,
  finalizeKycFileUpload,
  saveKycDetails,
  submitKycForReview,
} from "./actions";
import { FILE_KIND_LABELS } from "@/lib/onboarding/kyc-requirements";
import {
  Banknote,
  Building2,
  FileBadge,
  FileCheck,
  FileText,
  IdCard,
  Image as ImageIcon,
  Landmark,
  MapPin,
  Paperclip,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ObButton } from "@/components/onboarding-ui/buttons";
import { StatusPill, scanStatusTone } from "@/components/onboarding-ui/status-pill";
import { UploadRow } from "@/components/onboarding-ui/upload-row";
import { OB_INPUT_CLASS, OB_LABEL_CLASS } from "@/components/onboarding-ui/form-styles";
import type { OnboardingEntityType, OnboardingFileKind, ScanStatus } from "@prisma/client";

type FileInfo = { kind: OnboardingFileKind; fileName: string; version: number; scanStatus: ScanStatus };
type KycInfo = {
  panName: string | null;
  aadhaarHolderName: string | null;
  aadhaarLast4: string | null;
  companyName: string | null;
  companyPan: string | null;
  authorisedSignatoryName: string | null;
  hasPan: boolean;
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

const SCAN_LABELS: Record<ScanStatus, string> = {
  CLEAN: "Clean",
  PENDING: "Scanning…",
  INFECTED: "Rejected",
  ERROR: "Scan error",
};

function scanBadge(status: ScanStatus) {
  return (
    <StatusPill tone={scanStatusTone(status)} size="sm">
      {SCAN_LABELS[status] ?? "Scan error"}
    </StatusPill>
  );
}

const KIND_ICONS: Record<OnboardingFileKind, LucideIcon> = {
  PAN: IdCard,
  AADHAAR: IdCard,
  COMPANY_DOC: Building2,
  SIGNATORY_PROOF: FileBadge,
  PAYMENT_RECEIPT: FileText,
  ADDRESS_PROOF: MapPin,
  PHOTOGRAPH: ImageIcon,
  BANK_STATEMENT: Landmark,
  CANCELLED_CHEQUE: Banknote,
  GST_CERT: FileCheck,
  PARTNERSHIP_DEED: Users,
  OTHER_SUPPORTING: Paperclip,
};

function FileUploader({
  kind,
  existing,
  editable,
  required = false,
}: {
  kind: OnboardingFileKind;
  existing: FileInfo | undefined;
  editable: boolean;
  required?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError("File is too large (max 10MB).");
        setStatus("error");
        return;
      }
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError("Only PDF, JPG or PNG files are accepted.");
        setStatus("error");
        return;
      }
      const presign = await getPresignedOnboardingUpload({
        kind,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      });
      if ("error" in presign) {
        setError(presign.error);
        setStatus("error");
        return;
      }
      const put = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) {
        setError("Upload to storage failed. Try again.");
        setStatus("error");
        return;
      }
      const result = await finalizeKycFileUpload({
        kind,
        key: presign.key,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      });
      if ("error" in result) {
        setError(result.error);
        setStatus("error");
        return;
      }
      setStatus("idle");
      router.refresh();
    } catch (err) {
      console.error(`[KYC upload] ${kind} failed:`, err);
      setError("Something went wrong. Try again.");
      setStatus("error");
    }
  }

  const label = FILE_KIND_LABELS[kind];
  return (
    <UploadRow
      icon={KIND_ICONS[kind]}
      title={label}
      required={required}
      status={
        existing ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-all">
              {existing.fileName} (v{existing.version})
            </span>
            {scanBadge(existing.scanStatus)}
          </span>
        ) : (
          "Not uploaded yet"
        )
      }
      action={
        editable && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
            <ObButton
              variant={required ? "solid" : "outline"}
              aria-label={`${existing ? "Replace" : "Upload"} ${label}`}
              disabled={status === "uploading"}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-[18px] sm:size-[16px]" strokeWidth={2} aria-hidden />
              {status === "uploading" ? "Uploading…" : existing ? "Replace" : "Upload"}
            </ObButton>
          </>
        )
      }
    >
      {error && (
        <p className="mt-3 text-sm font-medium text-[#8a1c14]" role="alert">
          {error}
        </p>
      )}
    </UploadRow>
  );
}

export function KycSection({
  entityType,
  requiredKinds,
  optionalKinds,
  files,
  kyc,
  editable,
}: {
  entityType: OnboardingEntityType;
  requiredKinds: OnboardingFileKind[];
  optionalKinds: OnboardingFileKind[];
  files: FileInfo[];
  kyc: KycInfo | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [detailsState, detailsAction, detailsPending] = useActionState(saveKycDetails, undefined);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileByKind = new Map(files.map((f) => [f.kind, f]));

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    const result = await submitKycForReview();
    setSubmitting(false);
    if (result.error) {
      setSubmitError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {requiredKinds.map((kind) => (
          <FileUploader key={kind} kind={kind} existing={fileByKind.get(kind)} editable={editable} required />
        ))}
      </div>

      {optionalKinds.length > 0 && (
        <div className="mt-8 border-t border-[var(--ob-green)]/12 pt-7">
          <h3 className="ob-display text-[22px] font-semibold text-[var(--ob-green)] sm:text-[19px]">Additional documents (optional)</h3>
          <p className="mt-2 text-[15px] leading-normal sm:text-sm text-[var(--ob-text-2)]">
            Not required to submit your KYC, but upload any that apply — it can speed up review.
          </p>
          <div className="mt-5 space-y-3">
            {optionalKinds.map((kind) => (
              <FileUploader key={kind} kind={kind} existing={fileByKind.get(kind)} editable={editable} />
            ))}
          </div>
        </div>
      )}

      <form action={detailsAction} className="space-y-4 border-t border-[var(--ob-green)]/12 pt-7">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className={OB_LABEL_CLASS} htmlFor="panNumber">PAN number {kyc?.hasPan && "(on file — leave blank to keep)"}</Label>
            <Input className={OB_INPUT_CLASS} id="panNumber" name="panNumber" placeholder="ABCDE1234F" disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label className={OB_LABEL_CLASS} htmlFor="panName">Name on PAN</Label>
            <Input className={OB_INPUT_CLASS} id="panName" name="panName" defaultValue={kyc?.panName ?? ""} disabled={!editable} />
          </div>
        </div>

        {entityType === "INDIVIDUAL" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className={OB_LABEL_CLASS} htmlFor="aadhaarHolderName">Name on Aadhaar</Label>
              <Input
                className={OB_INPUT_CLASS}
                id="aadhaarHolderName"
                name="aadhaarHolderName"
                defaultValue={kyc?.aadhaarHolderName ?? ""}
                disabled={!editable}
              />
            </div>
            <div className="space-y-2">
              <Label className={OB_LABEL_CLASS} htmlFor="aadhaarLast4">Aadhaar — last 4 digits only</Label>
              <Input
                className={OB_INPUT_CLASS}
                id="aadhaarLast4"
                name="aadhaarLast4"
                maxLength={4}
                pattern="[0-9]{4}"
                defaultValue={kyc?.aadhaarLast4 ?? ""}
                disabled={!editable}
              />
              <p className="text-sm text-[var(--ob-muted)]">
                Never enter your full Aadhaar number — only the last 4 digits are stored.
              </p>
            </div>
          </div>
        )}

        {entityType === "COMPANY" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className={OB_LABEL_CLASS} htmlFor="companyName">Company name</Label>
              <Input className={OB_INPUT_CLASS} id="companyName" name="companyName" defaultValue={kyc?.companyName ?? ""} disabled={!editable} />
            </div>
            <div className="space-y-2">
              <Label className={OB_LABEL_CLASS} htmlFor="companyPan">Company PAN</Label>
              <Input className={OB_INPUT_CLASS} id="companyPan" name="companyPan" defaultValue={kyc?.companyPan ?? ""} disabled={!editable} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className={OB_LABEL_CLASS} htmlFor="authorisedSignatoryName">Authorised signatory name</Label>
              <Input
                className={OB_INPUT_CLASS}
                id="authorisedSignatoryName"
                name="authorisedSignatoryName"
                defaultValue={kyc?.authorisedSignatoryName ?? ""}
                disabled={!editable}
              />
            </div>
          </div>
        )}

        {detailsState?.error && (
          <p className="text-sm font-medium text-[#8a1c14]" role="alert">
            {detailsState.error}
          </p>
        )}
        {detailsState?.success && <p className="text-sm font-medium text-[#1e5c3a]">Saved.</p>}

        {editable && (
          <ObButton type="submit" variant="outline" disabled={detailsPending}>
            {detailsPending ? "Saving…" : "Save details"}
          </ObButton>
        )}
      </form>

      {editable && (
        <div className="space-y-3 border-t border-[var(--ob-green)]/12 pt-7">
          {submitError && (
            <p className="text-sm font-medium text-[#8a1c14]" role="alert">
              {submitError}
            </p>
          )}
          <ObButton variant="solid" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit for review"}
          </ObButton>
        </div>
      )}
    </div>
  );
}
