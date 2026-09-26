import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canReviewPayment } from "@/lib/permissions";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { formatMoney, formatDateOnly } from "@/lib/onboarding/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DecisionForm } from "../../decision-form";
import { decidePayment } from "../../actions";

export default async function PaymentReviewDetailPage({ params }: PageProps<"/reviews/payment/[id]">) {
  const user = await requireUser();
  if (!canReviewPayment(user)) redirect("/reviews");

  const { id } = await params;
  const onboarding = await db.storeOnboarding.findUnique({
    where: { id },
    include: {
      franchisee: { select: { name: true, email: true } },
      payments: { orderBy: { createdAt: "desc" }, take: 1, include: { receiptFile: true, uploadedBy: true } },
    },
  });
  const payment = onboarding?.payments[0];
  if (!onboarding || !payment) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {formatOnboardingCode(onboarding.seq)} — {onboarding.brand} {onboarding.proposedLocation}
        </h1>
        <p className="text-sm text-muted-foreground">
          {onboarding.franchisee.name} ({onboarding.franchisee.email})
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment submission</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">LOI fee amount:</span> {formatMoney(onboarding.expectedAmount)}
          </div>
          <div>
            <span className="text-muted-foreground">Declared amount:</span> {formatMoney(payment.declaredAmount)}
          </div>
          <div>
            <span className="text-muted-foreground">Payment date:</span> {formatDateOnly(payment.paymentDate)}
          </div>
          <div>
            <span className="text-muted-foreground">Mode:</span> {payment.mode}
          </div>
          <div>
            <span className="text-muted-foreground">UTR:</span> {payment.utr}
          </div>
          <div>
            <span className="text-muted-foreground">Uploaded by:</span> {payment.uploadedBy.name}
          </div>
          {payment.flags.length > 0 && (
            <div className="flex gap-2 pt-1">
              {payment.flags.map((f) => (
                <Badge key={f} variant="destructive">
                  {f.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}
          <div className="pt-2">
            <Link
              href={`/api/onboarding-files/${payment.receiptFile.id}/download`}
              className="text-primary hover:underline"
              target="_blank"
            >
              Open receipt ({payment.receiptFile.fileName})
            </Link>
          </div>
        </CardContent>
      </Card>

      {payment.status === "SUBMITTED" ? (
        <DecisionForm
          action={decidePayment.bind(null, onboarding.id)}
          acceptLabel="Accept payment"
          rejectLabel="Request changes"
          requireAmountOnAccept
          backHref="/reviews?tab=payment"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Current status: {payment.status} — nothing to decide right now.
        </p>
      )}

      <Link href="/reviews?tab=payment" className="text-sm text-muted-foreground hover:underline">
        ← Back to Payment queue
      </Link>
    </div>
  );
}
