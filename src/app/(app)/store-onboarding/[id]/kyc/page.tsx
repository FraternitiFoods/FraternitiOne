import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canViewOnboarding, canReviewKyc, canManageOnboardingAdmin } from "@/lib/permissions";
import { decryptPan } from "@/lib/onboarding/pan-encryption";
import { FILE_KIND_LABELS, requiredKycFileKinds } from "@/lib/onboarding/kyc-requirements";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { REVIEW_STATUS_LABELS } from "@/lib/onboarding/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DecisionForm } from "../decision-form";
import { decideKyc } from "../review-actions";

export default async function OnboardingKycPage({ params }: PageProps<"/store-onboarding/[id]/kyc">) {
  const user = await requireUser();
  const { id } = await params;

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id },
    include: {
      franchisee: { select: { name: true, email: true } },
      kyc: true,
      files: { where: { supersededBy: null, kind: { not: "PAYMENT_RECEIPT" } } },
    },
  });
  if (!onboarding || !canViewOnboarding(user, onboarding)) {
    notFound();
  }

  const canReview = canReviewKyc(user) || canManageOnboardingAdmin(user);
  const statusLabel = onboarding.kyc ? REVIEW_STATUS_LABELS[onboarding.kyc.status] : REVIEW_STATUS_LABELS.MISSING;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/store-onboarding/${onboarding.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ChevronLeft className="size-4" />
          {formatOnboardingCode(onboarding.seq)} — {onboarding.brand} {onboarding.proposedLocation}
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-2xl font-semibold">KYC</h1>
          <Badge variant={onboarding.kyc?.status === "ACCEPTED" ? "default" : "outline"}>{statusLabel}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {onboarding.franchisee.name} ({onboarding.franchisee.email})
        </p>
      </div>

      {!onboarding.kyc ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Not submitted yet — the franchisee hasn&apos;t uploaded KYC documents.
          </CardContent>
        </Card>
      ) : !canReview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">Status:</span> {statusLabel}
            </div>
            {onboarding.kyc.decisionReason && (
              <div>
                <span className="text-muted-foreground">Last reviewer note:</span> {onboarding.kyc.decisionReason}
              </div>
            )}
            <p className="pt-2 text-xs text-muted-foreground">
              Full KYC documents and identity details are visible to KYC reviewers only.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {(() => {
            let panNumber = "—";
            if (onboarding.kyc.panNumberEncrypted) {
              try {
                panNumber = decryptPan(onboarding.kyc.panNumberEncrypted);
              } catch {
                panNumber = "(decryption failed — check PAN_ENCRYPTION_KEY)";
              }
            }
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Details ({onboarding.entityType})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div>
                    <span className="text-muted-foreground">PAN:</span> {panNumber} ({onboarding.kyc.panName})
                  </div>
                  {onboarding.entityType === "INDIVIDUAL" && (
                    <div>
                      <span className="text-muted-foreground">Aadhaar:</span> {onboarding.kyc.aadhaarHolderName} —
                      ****{onboarding.kyc.aadhaarLast4}
                    </div>
                  )}
                  {onboarding.entityType === "COMPANY" && (
                    <>
                      <div>
                        <span className="text-muted-foreground">Company:</span> {onboarding.kyc.companyName} (PAN:{" "}
                        {onboarding.kyc.companyPan})
                      </div>
                      <div>
                        <span className="text-muted-foreground">Authorised signatory:</span>{" "}
                        {onboarding.kyc.authorisedSignatoryName}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {(() => {
            const requiredKinds = requiredKycFileKinds(onboarding.entityType);
            const requiredKindSet = new Set(requiredKinds);
            // plan.md 20C: optional kinds the franchisee actually uploaded still
            // need to be visible to the reviewer — review stays whole-KYC (one
            // accept/changes-requested decision), but a reviewer can't account
            // for a document they can't see.
            const optionalUploadedKinds = onboarding.files
              .map((f) => f.kind)
              .filter((kind) => !requiredKindSet.has(kind));

            return (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Files</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {requiredKinds.map((kind) => {
                      const file = onboarding.files.find((f) => f.kind === kind);
                      return (
                        <div key={kind} className="flex items-center justify-between rounded-md border p-2 text-sm">
                          <span>{FILE_KIND_LABELS[kind]}</span>
                          {file ? (
                            <div className="flex items-center gap-2">
                              <Badge variant={file.scanStatus === "CLEAN" ? "default" : "destructive"}>
                                {file.scanStatus}
                              </Badge>
                              <Link
                                href={`/api/onboarding-files/${file.id}/download`}
                                className="text-primary hover:underline"
                                target="_blank"
                              >
                                Open
                              </Link>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Not uploaded</span>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {optionalUploadedKinds.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Additional documents (optional)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {optionalUploadedKinds.map((kind) => {
                        const file = onboarding.files.find((f) => f.kind === kind);
                        if (!file) return null;
                        return (
                          <div key={kind} className="flex items-center justify-between rounded-md border p-2 text-sm">
                            <span>{FILE_KIND_LABELS[kind]}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant={file.scanStatus === "CLEAN" ? "default" : "destructive"}>
                                {file.scanStatus}
                              </Badge>
                              <Link
                                href={`/api/onboarding-files/${file.id}/download`}
                                className="text-primary hover:underline"
                                target="_blank"
                              >
                                Open
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}
              </>
            );
          })()}

          {onboarding.kyc.status === "SUBMITTED" ? (
            <DecisionForm
              action={decideKyc.bind(null, onboarding.id)}
              acceptLabel="Accept KYC"
              rejectLabel="Request changes"
              backHref={`/store-onboarding/${onboarding.id}/kyc`}
            />
          ) : (
            onboarding.kyc.decisionReason && (
              <p className="text-sm text-muted-foreground">Last reviewer note: {onboarding.kyc.decisionReason}</p>
            )
          )}
        </>
      )}
    </div>
  );
}
