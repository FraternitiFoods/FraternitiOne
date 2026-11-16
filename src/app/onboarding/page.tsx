import { ArrowRight, CreditCard, FileText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import {
  ONBOARDING_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  LOI_VERSION_STATUS_LABELS,
  formatMoney,
  nextActionLabel,
} from "@/lib/onboarding/format";
import { computeOnboardingCompletion } from "@/lib/onboarding/completion";
import { getRecentEmails } from "@/lib/onboarding/recent-emails";
import { welcomeAction } from "@/lib/onboarding/welcome-steps";
import { ObCard, ObCardTitle, ObEyebrow } from "@/components/onboarding-ui/card";
import { Rangoli, LeafWatermark } from "@/components/onboarding-ui/decor";
import { CodeChip } from "@/components/onboarding-ui/page-header";
import { StageStepper } from "@/components/onboarding-ui/stage-stepper";
import { StatusPill, reviewStatusTone } from "@/components/onboarding-ui/status-pill";
import { SegmentBar } from "@/components/onboarding-ui/segment-bar";
import { ObEmailsCard } from "@/components/onboarding-ui/emails-card";
import { ObLinkButton } from "@/components/onboarding-ui/buttons";

const PROGRESS_PILLS: { key: string; label: string }[] = [
  { key: "AWAITING_KYC_PAYMENT", label: "KYC & Payment" },
  { key: "UNDER_REVIEW", label: "Under Review" },
  { key: "READY_FOR_SIGNATURE", label: "Ready to Sign" },
  { key: "FRANCHISE_SIGNED", label: "Awaiting Company" },
  { key: "LOI_COMPLETE", label: "Complete" },
];

const PILL_ORDER = PROGRESS_PILLS.map((p) => p.key);

export default async function OnboardingHomePage() {
  const user = await requireUser();

  // Layout already guarantees this exists and isn't LOI_COMPLETE.
  const onboarding = await db.storeOnboarding.findUniqueOrThrow({
    where: { franchiseeUserId: user.id },
    include: {
      kyc: true,
      files: { where: { supersededBy: null }, select: { kind: true } },
      currentLoiVersion: { select: { status: true } },
    },
  });

  // CORRECTIONS_REQUESTED renders at the same pill position as UNDER_REVIEW —
  // it's a sub-state of the review phase, not a step further along.
  const effectiveStatus =
    onboarding.onboardingStatus === "CORRECTIONS_REQUESTED"
      ? "UNDER_REVIEW"
      : onboarding.onboardingStatus;
  const currentIndex = PILL_ORDER.indexOf(effectiveStatus);

  // plan.md section 20B — this page only ever renders before LOI_COMPLETE
  // (the layout redirects a converted franchisee to /dashboard), so there is
  // never a Dashboard site yet here: site progress lives on /dashboard,
  // for after conversion. What *is* relevant pre-conversion —
  // Onboarding Completion, LOI status, latest emails — is added below.
  // KYC status / Payment status already have their own cards above.
  const completion = computeOnboardingCompletion({
    entityType: onboarding.entityType,
    kyc: onboarding.kyc,
    uploadedFileKinds: onboarding.files.map((f) => f.kind),
    paymentStatus: onboarding.paymentStatus,
  });
  const recentEmails = await getRecentEmails(onboarding.id);

  // "See your progress" is this very page, so a button for it would be a no-op: only show real next steps.
  const action = welcomeAction(onboarding.onboardingStatus);
  const showAction = action.href !== "/onboarding";

  return (
    <div className="relative">
      <Rangoli />

      <div className="relative z-10 space-y-6">
        <section>
          <CodeChip>{formatOnboardingCode(onboarding.seq)}</CodeChip>
          <h1 className="ob-display mt-[22px] text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.02em] text-[var(--ob-green)] sm:text-[3.5rem]">
            {onboarding.brand} {onboarding.proposedLocation}
          </h1>
          <p className="mt-3 text-lg text-[var(--ob-text-2)]">Welcome, {user.name}.</p>
        </section>

        <div className="pt-3">
          <StageStepper stages={PROGRESS_PILLS} currentIndex={currentIndex} />
        </div>

        <ObCard tone="dark" className="flex flex-wrap items-center gap-x-10 gap-y-6 px-7 py-8 sm:px-9">
          <LeafWatermark className="-bottom-[70px] right-[200px] size-60 opacity-10" />
          <div className="relative min-w-0 flex-[1_1_20rem]">
            <div className="text-xs font-bold tracking-[0.16em] text-[var(--ob-saffron)] uppercase">Next action</div>
            <p className="ob-display mt-3 text-2xl leading-[1.3] font-medium sm:text-[26px]">
              {nextActionLabel(onboarding)}
            </p>
          </div>
          {showAction && (
            <ObLinkButton href={action.href} variant="saffron" size="lg" className="relative max-sm:w-full">
              {action.label}
              <ArrowRight className="size-[18px]" strokeWidth={2.2} aria-hidden />
            </ObLinkButton>
          )}
        </ObCard>

        <div className="grid gap-6 md:grid-cols-2">
          <ObCard className="flex flex-col gap-4 px-7 py-7 sm:px-8">
            <div className="flex items-center justify-between gap-3">
              <ObCardTitle>KYC status</ObCardTitle>
              <FileText className="size-[22px] text-[var(--ob-muted)]" strokeWidth={1.8} aria-hidden />
            </div>
            <StatusPill tone={reviewStatusTone(onboarding.kycStatus)} className="self-start">
              {REVIEW_STATUS_LABELS[onboarding.kycStatus]}
            </StatusPill>
          </ObCard>

          <ObCard className="flex flex-col gap-4 px-7 py-7 sm:px-8">
            <div className="flex items-center justify-between gap-3">
              <ObCardTitle>Payment status</ObCardTitle>
              <CreditCard className="size-[22px] text-[var(--ob-muted)]" strokeWidth={1.8} aria-hidden />
            </div>
            <StatusPill tone={reviewStatusTone(onboarding.paymentStatus)} className="self-start">
              {REVIEW_STATUS_LABELS[onboarding.paymentStatus]}
            </StatusPill>
            <p className="text-[15px] text-[var(--ob-text-2)]">
              LOI fee: <strong className="text-[var(--ob-green)]">{formatMoney(onboarding.expectedAmount)}</strong>
            </p>
          </ObCard>

          <ObCard className="px-7 py-7 sm:px-8">
            <ObEyebrow>Onboarding Completion</ObEyebrow>
            <div className="ob-display mt-2.5 text-[4rem] leading-none font-semibold tracking-[-0.02em] text-[var(--ob-green)]">
              {completion.completed}/{completion.total}
            </div>
            <p className="mt-3 text-[15px] text-[var(--ob-text-2)]">Required items submitted</p>
            <div className="mt-[18px]">
              <SegmentBar total={completion.total} filled={completion.completed} />
            </div>
          </ObCard>

          <ObCard className="px-7 py-7 sm:px-8">
            <ObEyebrow>LOI Status</ObEyebrow>
            <div className="ob-display mt-3.5 max-w-[16rem] text-4xl leading-[1.15] font-semibold tracking-[-0.01em] text-[var(--ob-green)]">
              {onboarding.currentLoiVersion
                ? LOI_VERSION_STATUS_LABELS[onboarding.currentLoiVersion.status]
                : "Not yet generated"}
            </div>
            <FileText
              className="absolute right-7 bottom-6 size-16 text-[#b9ad8e]"
              strokeWidth={1.2}
              strokeDasharray="2.2 2.2"
              aria-hidden
            />
          </ObCard>
        </div>

        <ObEmailsCard emails={recentEmails} title="Latest emails sent" />

        <div className="inline-flex items-center gap-2.5 rounded-full bg-[var(--ob-sidebar)] px-[18px] py-2.5 text-sm text-[var(--ob-nav)]">
          <span aria-hidden className="size-[9px] rounded-full bg-[var(--ob-saffron)]" />
          <span>
            Overall status:{" "}
            <strong className="text-[var(--ob-green)]">{ONBOARDING_STATUS_LABELS[onboarding.onboardingStatus]}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
