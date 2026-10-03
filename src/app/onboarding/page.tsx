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
import { getRecentEmails } from "@/lib/dashboard/widgets";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { RecentEmailsCard } from "@/components/recent-emails-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  // never a FranchiseProject yet here: Sales This Month, Open Complaints and
  // Project Progress don't apply on this page and live on /dashboard
  // instead, for after conversion. What *is* relevant pre-conversion —
  // Onboarding Completion, LOI status, latest emails — is added below.
  // KYC status / Payment status already have their own cards above.
  const completion = computeOnboardingCompletion({
    entityType: onboarding.entityType,
    kyc: onboarding.kyc,
    uploadedFileKinds: onboarding.files.map((f) => f.kind),
    paymentStatus: onboarding.paymentStatus,
  });
  const recentEmails = await getRecentEmails(onboarding.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {formatOnboardingCode(onboarding.seq)} — {onboarding.brand} {onboarding.proposedLocation}
        </h1>
        <p className="text-sm text-muted-foreground">Welcome, {user.name}.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PROGRESS_PILLS.map((pill, i) => (
          <Badge
            key={pill.key}
            variant={i <= currentIndex ? "default" : "outline"}
            className="px-3 py-1"
          >
            {pill.label}
          </Badge>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next action</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{nextActionLabel(onboarding)}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">KYC status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">{REVIEW_STATUS_LABELS[onboarding.kycStatus]}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <Badge variant="outline">{REVIEW_STATUS_LABELS[onboarding.paymentStatus]}</Badge>
            <p className="text-xs text-muted-foreground">
              LOI fee: {formatMoney(onboarding.expectedAmount)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Onboarding Completion"
          value={`${completion.completed}/${completion.total}`}
          caption="Required items submitted"
        />
        <StatCard
          label="LOI Status"
          value={
            onboarding.currentLoiVersion
              ? LOI_VERSION_STATUS_LABELS[onboarding.currentLoiVersion.status]
              : "Not yet generated"
          }
        />
      </div>

      <RecentEmailsCard emails={recentEmails} title="Latest emails sent" />

      <p className="text-xs text-muted-foreground">
        Overall status: {ONBOARDING_STATUS_LABELS[onboarding.onboardingStatus]}
      </p>
    </div>
  );
}
