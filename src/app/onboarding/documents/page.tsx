import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { requiredKycFileKinds, FILE_KIND_LABELS } from "@/lib/onboarding/kyc-requirements";
import { REVIEW_STATUS_LABELS } from "@/lib/onboarding/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KycSection } from "./kyc-section";
import { PaymentSection } from "./payment-section";

export default async function OnboardingDocumentsPage() {
  const user = await requireUser();

  const onboarding = await db.storeOnboarding.findUniqueOrThrow({
    where: { franchiseeUserId: user.id },
    include: {
      kyc: true,
      files: { where: { supersededBy: null }, orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const requiredKinds = requiredKycFileKinds(onboarding.entityType);
  const kycFiles = onboarding.files.filter((f) => f.kind !== "PAYMENT_RECEIPT");
  const editable = onboarding.kycStatus === "MISSING" || onboarding.kycStatus === "CHANGES_REQUESTED";
  const paymentEditable =
    onboarding.paymentStatus === "MISSING" || onboarding.paymentStatus === "CHANGES_REQUESTED";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">KYC &amp; Documents</h1>
        <p className="text-sm text-muted-foreground">
          Required documents: {requiredKinds.map((k) => FILE_KIND_LABELS[k]).join(", ")}.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">KYC</CardTitle>
          <Badge variant="outline">{REVIEW_STATUS_LABELS[onboarding.kycStatus]}</Badge>
        </CardHeader>
        <CardContent>
          {onboarding.kyc?.decisionReason && onboarding.kycStatus === "CHANGES_REQUESTED" && (
            <p className="mb-4 rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <strong>Changes requested:</strong> {onboarding.kyc.decisionReason}
            </p>
          )}
          <KycSection
            entityType={onboarding.entityType}
            requiredKinds={requiredKinds}
            files={kycFiles.map((f) => ({
              kind: f.kind,
              fileName: f.fileName,
              version: f.version,
              scanStatus: f.scanStatus,
            }))}
            kyc={
              onboarding.kyc
                ? {
                    panName: onboarding.kyc.panName,
                    aadhaarHolderName: onboarding.kyc.aadhaarHolderName,
                    aadhaarLast4: onboarding.kyc.aadhaarLast4,
                    companyName: onboarding.kyc.companyName,
                    companyPan: onboarding.kyc.companyPan,
                    authorisedSignatoryName: onboarding.kyc.authorisedSignatoryName,
                    hasPan: !!onboarding.kyc.panNumberEncrypted,
                  }
                : null
            }
            editable={editable}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Payment receipt</CardTitle>
          <Badge variant="outline">{REVIEW_STATUS_LABELS[onboarding.paymentStatus]}</Badge>
        </CardHeader>
        <CardContent>
          {onboarding.payments[0]?.decisionReason && onboarding.paymentStatus === "CHANGES_REQUESTED" && (
            <p className="mb-4 rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <strong>Changes requested:</strong> {onboarding.payments[0].decisionReason}
            </p>
          )}
          <PaymentSection
            expectedAmount={onboarding.expectedAmount}
            latestPayment={
              onboarding.payments[0]
                ? {
                    declaredAmount: onboarding.payments[0].declaredAmount,
                    mode: onboarding.payments[0].mode,
                    utr: onboarding.payments[0].utr,
                    paymentDate: onboarding.payments[0].paymentDate.toISOString(),
                  }
                : null
            }
            editable={paymentEditable}
          />
        </CardContent>
      </Card>
    </div>
  );
}
