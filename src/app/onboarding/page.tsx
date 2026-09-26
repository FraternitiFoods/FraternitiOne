import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import {
  ONBOARDING_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  formatMoney,
  nextActionLabel,
} from "@/lib/onboarding/format";
import { Badge } from "@/components/ui/badge";
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
  });

  // CORRECTIONS_REQUESTED renders at the same pill position as UNDER_REVIEW —
  // it's a sub-state of the review phase, not a step further along.
  const effectiveStatus =
    onboarding.onboardingStatus === "CORRECTIONS_REQUESTED"
      ? "UNDER_REVIEW"
      : onboarding.onboardingStatus;
  const currentIndex = PILL_ORDER.indexOf(effectiveStatus);

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

      <p className="text-xs text-muted-foreground">
        Overall status: {ONBOARDING_STATUS_LABELS[onboarding.onboardingStatus]}
      </p>
    </div>
  );
}
