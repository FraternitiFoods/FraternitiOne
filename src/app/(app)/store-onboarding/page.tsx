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
import { StatCard } from "@/components/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeleteOnboardingButton } from "./delete-onboarding-button";

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

  const canDelete = canManageOnboardingAdmin(user);

  // plan.md section 20B — lightweight summary strip, additive only (no
  // search/filter/export UI here — that's 20D, the next task, and it will
  // build on top of this same list/table). Deliberately computed from the
  // `onboardings` array already fetched above rather than a second query, so
  // it's always in sync with the table below — on purpose, this strip
  // carries over today's known pre-20D scope gap (Step 0's build-log note:
  // the list has no `where` at all, every onboarding-touching role sees
  // every onboarding) rather than introducing a new one. Once 20D adds
  // SALES scoping to this page's query, this strip scopes correctly too,
  // automatically, since it reads from that same array.
  const summary = {
    total: onboardings.length,
    kycPending: onboardings.filter((o) => o.kycStatus !== "ACCEPTED").length,
    paymentPending: onboardings.filter((o) => o.paymentStatus !== "ACCEPTED").length,
    loiPending: onboardings.filter((o) => o.onboardingStatus !== "LOI_COMPLETE").length,
    converted: onboardings.filter((o) => o.onboardingStatus === "LOI_COMPLETE").length,
  };

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

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Onboardings" value={summary.total} />
        <StatCard label="KYC Pending" value={summary.kycPending} />
        <StatCard label="Payment Pending" value={summary.paymentPending} />
        <StatCard label="LOI Pending" value={summary.loiPending} />
        <StatCard label="Converted (LOI Complete)" value={summary.converted} />
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
                <TableHead>Project</TableHead>
                {canDelete && <TableHead />}
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
                  <TableCell>
                    {o.projectId ? (
                      <Link href={`/projects/${o.projectId}`} className="underline underline-offset-4">
                        View →
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {canDelete && (
                    <TableCell>
                      <DeleteOnboardingButton
                        onboardingId={o.id}
                        storeLabel={`${formatOnboardingCode(o.seq)} — ${o.brand} ${o.proposedLocation}`}
                        franchiseeEmail={o.franchisee.email}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
