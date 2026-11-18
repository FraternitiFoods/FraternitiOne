import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { requiredKycFileKinds, FILE_KIND_LABELS, OPTIONAL_FILE_KINDS } from "@/lib/onboarding/kyc-requirements";
import { REVIEW_STATUS_LABELS } from "@/lib/onboarding/format";
import { ObCard, ObCardTitle } from "@/components/onboarding-ui/card";
import { Rangoli } from "@/components/onboarding-ui/decor";
import { StatusPill, reviewStatusTone } from "@/components/onboarding-ui/status-pill";
import { KycSection } from "./kyc-section";
import { PaymentSection } from "./payment-section";
import { ScanPoller } from "./scan-poller";

// Raised from Vercel's unconfigured default: finalizeKycFileUpload/
// submitPaymentReceipt's after() callback calls a real malware scanner
// (src/lib/malware-scan), a third-party HTTP request with its own 15s
// internal timeout — this must stay comfortably above that so the
// serverless invocation doesn't get killed mid-scan, leaving the file stuck
// on scanStatus=PENDING. Server Action timeouts are configured at the page
// level (Next.js maxDuration docs), not in actions.ts itself.
export const maxDuration = 20;

export default async function OnboardingDocumentsPage() {
  const user = await requireUser();

  const onboarding = await db.storeOnboarding.findUniqueOrThrow({
    where: { franchiseeUserId: user.id },
    include: {
      kyc: true,
      files: { where: { supersededBy: null }, orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });

  const requiredKinds = requiredKycFileKinds(onboarding.entityType);
  const kycFiles = onboarding.files.filter((f) => f.kind !== "PAYMENT_RECEIPT");
  const editable = onboarding.kycStatus === "MISSING" || onboarding.kycStatus === "CHANGES_REQUESTED";
  const totalVerifiedAmount = onboarding.payments.reduce((sum, p) => sum + (p.verifiedAmount ?? 0), 0);
  const hasPendingPayment = onboarding.payments.some((p) => p.status === "SUBMITTED");
  const paymentEditable = !hasPendingPayment && totalVerifiedAmount < onboarding.expectedAmount;

  const hasScanPending = onboarding.files.some((f) => f.scanStatus === "PENDING");

  return (
    <div className="relative">
      <Rangoli />

      <div className="relative z-10 space-y-9">
        <ScanPoller pending={hasScanPending} />
        <div>
          <h1 className="ob-display text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.02em] text-[var(--ob-green)] sm:text-[3rem]">
            KYC &amp; Documents
          </h1>
          <p className="mt-3 text-lg leading-normal text-[var(--ob-text-2)]">
            Required documents: {requiredKinds.map((k) => FILE_KIND_LABELS[k]).join(", ")}.
          </p>
        </div>

        <ObCard className="p-5 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <ObCardTitle className="text-[28px] sm:text-[24px]">KYC</ObCardTitle>
            <StatusPill tone={reviewStatusTone(onboarding.kycStatus)}>{REVIEW_STATUS_LABELS[onboarding.kycStatus]}</StatusPill>
          </div>
          <div className="mt-[22px] sm:mt-[19px]">
            {onboarding.kyc?.decisionReason && onboarding.kycStatus === "CHANGES_REQUESTED" && (
              <p className="mb-5 rounded-[20px] border border-[#e58a1f]/40 bg-[#fbe6c8] px-5 py-4 text-[15px] text-[#7a4200] sm:rounded-[17px] sm:text-sm">
                <strong>Changes requested:</strong> {onboarding.kyc.decisionReason}
              </p>
            )}
            <KycSection
              entityType={onboarding.entityType}
              requiredKinds={requiredKinds}
              optionalKinds={OPTIONAL_FILE_KINDS}
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
          </div>
        </ObCard>

        <ObCard className="p-5 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <ObCardTitle className="text-[28px] sm:text-[24px]">Payment receipt</ObCardTitle>
            <StatusPill tone={reviewStatusTone(onboarding.paymentStatus)}>
              {REVIEW_STATUS_LABELS[onboarding.paymentStatus]}
            </StatusPill>
          </div>
          <div className="mt-[22px] sm:mt-[19px]">
            {onboarding.payments[0]?.decisionReason && onboarding.paymentStatus === "CHANGES_REQUESTED" && (
              <p className="mb-5 rounded-[20px] border border-[#e58a1f]/40 bg-[#fbe6c8] px-5 py-4 text-[15px] text-[#7a4200] sm:rounded-[17px] sm:text-sm">
                <strong>Changes requested:</strong> {onboarding.payments[0].decisionReason}
              </p>
            )}
            <PaymentSection
              expectedAmount={onboarding.expectedAmount}
              totalVerifiedAmount={totalVerifiedAmount}
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
          </div>
        </ObCard>
      </div>
    </div>
  );
}
