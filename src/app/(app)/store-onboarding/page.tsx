import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  canCreateOnboarding,
  canReviewKyc,
  canReviewPayment,
  canPrepareLoi,
  canCompanySign,
  canManageOnboardingAdmin,
} from "@/lib/permissions";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import {
  ONBOARDING_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  formatMoney,
} from "@/lib/onboarding/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function StoreOnboardingListPage() {
  const user = await requireUser();

  const canView =
    canCreateOnboarding(user) ||
    canReviewKyc(user) ||
    canReviewPayment(user) ||
    canPrepareLoi(user) ||
    canCompanySign(user) ||
    canManageOnboardingAdmin(user);

  if (!canView) {
    redirect("/dashboard");
  }

  const onboardings = await db.storeOnboarding.findMany({
    orderBy: { createdAt: "desc" },
    include: { franchisee: { select: { name: true, email: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Store Onboarding</h1>
          <p className="text-sm text-muted-foreground">
            Franchise onboarding, KYC, payment proof and LOI e-sign (plan.md section 17).
          </p>
        </div>
        {canCreateOnboarding(user) && (
          <Button nativeButton={false} render={<Link href="/store-onboarding/new">New Onboarding</Link>} />
        )}
      </div>

      {onboardings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No store onboardings yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Franchisee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>KYC</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Fee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {onboardings.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link href={`/store-onboarding/${o.id}`} className="font-medium hover:underline">
                      {formatOnboardingCode(o.seq)} — {o.brand} {o.proposedLocation}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div>{o.franchisee.name}</div>
                    <div className="text-xs text-muted-foreground">{o.franchisee.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ONBOARDING_STATUS_LABELS[o.onboardingStatus]}</Badge>
                  </TableCell>
                  <TableCell>{REVIEW_STATUS_LABELS[o.kycStatus]}</TableCell>
                  <TableCell>{REVIEW_STATUS_LABELS[o.paymentStatus]}</TableCell>
                  <TableCell>{formatMoney(o.expectedAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
