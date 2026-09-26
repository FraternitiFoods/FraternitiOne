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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

function scanBadge(status: ScanStatus) {
  if (status === "CLEAN") return <Badge variant="default">Clean</Badge>;
  if (status === "PENDING") return <Badge variant="outline">Scanning…</Badge>;
  return <Badge variant="destructive">{status === "INFECTED" ? "Rejected" : "Scan error"}</Badge>;
}

function FileUploader({
  kind,
  existing,
  editable,
}: {
  kind: OnboardingFileKind;
  existing: FileInfo | undefined;
  editable: boolean;
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
    } catch {
      setError("Something went wrong. Try again.");
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium">{FILE_KIND_LABELS[kind]}</div>
        {existing ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">
              {existing.fileName} (v{existing.version})
            </span>
            {scanBadge(existing.scanStatus)}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Not uploaded yet</div>
        )}
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      {editable && (
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={status === "uploading"}
            onClick={() => inputRef.current?.click()}
          >
            {status === "uploading" ? "Uploading…" : existing ? "Replace" : "Upload"}
          </Button>
        </>
      )}
    </div>
  );
}

export function KycSection({
  entityType,
  requiredKinds,
  files,
  kyc,
  editable,
}: {
  entityType: OnboardingEntityType;
  requiredKinds: OnboardingFileKind[];
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
    <div className="space-y-4">
      <div className="space-y-2">
        {requiredKinds.map((kind) => (
          <FileUploader key={kind} kind={kind} existing={fileByKind.get(kind)} editable={editable} />
        ))}
      </div>

      <form action={detailsAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="panNumber">PAN number {kyc?.hasPan && "(on file — leave blank to keep)"}</Label>
            <Input id="panNumber" name="panNumber" placeholder="ABCDE1234F" disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="panName">Name on PAN</Label>
            <Input id="panName" name="panName" defaultValue={kyc?.panName ?? ""} disabled={!editable} />
          </div>
        </div>

        {entityType === "INDIVIDUAL" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="aadhaarHolderName">Name on Aadhaar</Label>
              <Input
                id="aadhaarHolderName"
                name="aadhaarHolderName"
                defaultValue={kyc?.aadhaarHolderName ?? ""}
                disabled={!editable}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aadhaarLast4">Aadhaar — last 4 digits only</Label>
              <Input
                id="aadhaarLast4"
                name="aadhaarLast4"
                maxLength={4}
                pattern="[0-9]{4}"
                defaultValue={kyc?.aadhaarLast4 ?? ""}
                disabled={!editable}
              />
              <p className="text-xs text-muted-foreground">
                Never enter your full Aadhaar number — only the last 4 digits are stored.
              </p>
            </div>
          </div>
        )}

        {entityType === "COMPANY" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company name</Label>
              <Input id="companyName" name="companyName" defaultValue={kyc?.companyName ?? ""} disabled={!editable} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyPan">Company PAN</Label>
              <Input id="companyPan" name="companyPan" defaultValue={kyc?.companyPan ?? ""} disabled={!editable} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="authorisedSignatoryName">Authorised signatory name</Label>
              <Input
                id="authorisedSignatoryName"
                name="authorisedSignatoryName"
                defaultValue={kyc?.authorisedSignatoryName ?? ""}
                disabled={!editable}
              />
            </div>
          </div>
        )}

        {detailsState?.error && (
          <p className="text-sm text-destructive" role="alert">
            {detailsState.error}
          </p>
        )}
        {detailsState?.success && <p className="text-sm text-emerald-600">Saved.</p>}

        {editable && (
          <Button type="submit" variant="outline" disabled={detailsPending}>
            {detailsPending ? "Saving…" : "Save details"}
          </Button>
        )}
      </form>

      {editable && (
        <div className="space-y-2 border-t pt-4">
          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit for review"}
          </Button>
        </div>
      )}
    </div>
  );
}
