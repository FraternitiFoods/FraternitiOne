import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canViewOnboarding, canReviewPayment, canManageOnboardingAdmin } from "@/lib/permissions";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { formatMoney, formatDateOnly, REVIEW_STATUS_LABELS } from "@/lib/onboarding/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DecisionForm } from "../decision-form";
import { decidePayment } from "../review-actions";

export default async function OnboardingPaymentPage({ params }: PageProps<"/store-onboarding/[id]/payment">) {
  const user = await requireUser();
  const { id } = await params;

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id },
    include: {
      franchisee: { select: { name: true, email: true } },
      payments: { orderBy: { createdAt: "desc" }, include: { receiptFile: true, uploadedBy: true } },
    },
  });
  if (!onboarding || !canViewOnboarding(user, onboarding)) {
    notFound();
  }

  const canReview = canReviewPayment(user) || canManageOnboardingAdmin(user);
  const latestPayment = onboarding.payments[0] ?? null;
  // Same aggregation lib/onboarding/recompute.ts uses for the e-sign gate —
  // a franchisee can pay across multiple accepted submissions, so the total
  // (not just the latest row's verifiedAmount) is the number that matters.
  const totalVerified = onboarding.payments.reduce((sum, p) => sum + (p.verifiedAmount ?? 0), 0);
  const remaining = Math.max(onboarding.expectedAmount - totalVerified, 0);
  const amountStatus =
    totalVerified >= onboarding.expectedAmount && totalVerified > 0
      ? { label: "Paid", variant: "default" as const }
      : totalVerified > 0
        ? { label: "Partial", variant: "outline" as const }
        : { label: "Pending", variant: "outline" as const };

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
          <h1 className="text-2xl font-semibold">Payment</h1>
          <Badge variant={amountStatus.variant}>{amountStatus.label}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {onboarding.franchisee.name} ({onboarding.franchisee.email})
        </p>
      </div>

      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Actual amount
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="text-3xl font-semibold">{formatMoney(onboarding.expectedAmount)}</div>
          <div className="flex gap-6 pt-2 text-sm">
            <div>
              <span className="text-muted-foreground">Paid so far:</span> {formatMoney(totalVerified)}
            </div>
            <div>
              <span className="text-muted-foreground">Remaining:</span> {formatMoney(remaining)}
            </div>
          </div>
        </CardContent>
      </Card>

      {onboarding.payments.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No payment submitted yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {onboarding.payments.map((payment) => (
              <div key={payment.id} className="space-y-1 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{formatMoney(payment.declaredAmount)} declared</span>
                  <div className="flex items-center gap-2">
                    {payment.flags.map((f) => (
                      <Badge key={f} variant="destructive">
                        {f.replace(/_/g, " ")}
                      </Badge>
                    ))}
                    <Badge variant={payment.status === "ACCEPTED" ? "default" : "outline"}>
                      {REVIEW_STATUS_LABELS[payment.status]}
                    </Badge>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Date:</span> {formatDateOnly(payment.paymentDate)}
                </div>
                {canReview && (
                  <>
                    <div>
                      <span className="text-muted-foreground">Mode:</span> {payment.mode}
                    </div>
                    <div>
                      <span className="text-muted-foreground">UTR:</span> {payment.utr}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Uploaded by:</span> {payment.uploadedBy.name}
                    </div>
                    {payment.verifiedAmount !== null && (
                      <div>
                        <span className="text-muted-foreground">Verified amount:</span>{" "}
                        {formatMoney(payment.verifiedAmount)}
                      </div>
                    )}
                    {payment.decisionReason && (
                      <div>
                        <span className="text-muted-foreground">Reviewer note:</span> {payment.decisionReason}
                      </div>
                    )}
                    <div>
                      <Link
                        href={`/api/onboarding-files/${payment.receiptFile.id}/download`}
                        className="text-primary hover:underline"
                        target="_blank"
                      >
                        Open receipt ({payment.receiptFile.fileName})
                      </Link>
                    </div>
                  </>
                )}
              </div>
            ))}
            {!canReview && (
              <p className="text-xs text-muted-foreground">
                Payment mode, UTR and receipts are visible to Accounts reviewers only.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {canReview && latestPayment?.status === "SUBMITTED" && (
        <DecisionForm
          action={decidePayment.bind(null, onboarding.id)}
          acceptLabel="Accept payment"
          rejectLabel="Request changes"
          requireAmountOnAccept
          backHref={`/store-onboarding/${onboarding.id}/payment`}
        />
      )}
    </div>
  );
}
