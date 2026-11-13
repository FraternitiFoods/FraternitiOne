import Link from "next/link";
import { requireOnboardingUser } from "@/lib/onboarding-access";
import { db } from "@/lib/db";
import { canCompanySign, canCreateOnboarding, canManageOnboardingAdmin } from "@/lib/permissions";
import { onboardingListWhere } from "@/lib/onboarding/search";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { StoreOnboardingList } from "./store-onboarding-list";

export default async function StoreOnboardingListPage() {
  const user = await requireOnboardingUser();

  // plan.md section 20D — SALES only sees their own onboardings; every other
  // onboarding-touching role keeps the existing full-queue visibility.
  const where = onboardingListWhere(user);

  // plan.md section 20B — summary strip over the *whole* role-scoped queue,
  // not just the rows currently on screen (the table is capped with `take`).
  // ONE groupBy over the three status columns (a handful of combinations at
  // most) replaces the five separate count() round trips; both queries run in
  // parallel.
  const [onboardings, statusGroups] = await Promise.all([
    db.storeOnboarding.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        seq: true,
        brand: true,
        proposedLocation: true,
        onboardingStatus: true,
        kycStatus: true,
        paymentStatus: true,
        expectedAmount: true,
        franchisee: { select: { name: true, email: true } },
        salesOwner: { select: { name: true } },
        currentLoiVersion: { select: { status: true } },
        dashboardSite: { select: { name: true } },
      },
      // List view, not an export — cap the row count so this stays cheap to
      // query/render/serialize as the number of onboardings grows.
      take: 50,
    }),
    db.storeOnboarding.groupBy({
      by: ["onboardingStatus", "kycStatus", "paymentStatus"],
      where,
      _count: { _all: true },
    }),
  ]);

  const canDelete = canManageOnboardingAdmin(user);

  const summary = { total: 0, kycPending: 0, paymentPending: 0, loiPending: 0, converted: 0 };
  for (const g of statusGroups) {
    const n = g._count._all;
    summary.total += n;
    if (g.kycStatus !== "ACCEPTED") summary.kycPending += n;
    if (g.paymentStatus !== "ACCEPTED") summary.paymentPending += n;
    if (g.onboardingStatus === "LOI_COMPLETE") summary.converted += n;
    else summary.loiPending += n;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Store Onboarding</h1>
          <p className="text-sm text-muted-foreground">
            Franchise onboarding, KYC, payment proof and LOI e-sign.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCompanySign(user) && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/signing">Signing queue</Link>}
            />
          )}
          {canCreateOnboarding(user) && (
            <Button nativeButton={false} render={<Link href="/store-onboarding/new">New Onboarding</Link>} />
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Onboardings" value={summary.total} />
        <StatCard label="KYC Pending" value={summary.kycPending} />
        <StatCard label="Payment Pending" value={summary.paymentPending} />
        <StatCard label="LOI Pending" value={summary.loiPending} />
        <StatCard label="Converted (LOI Complete)" value={summary.converted} />
      </div>

      <StoreOnboardingList
        onboardings={onboardings.map((o) => ({
          id: o.id,
          seq: o.seq,
          code: formatOnboardingCode(o.seq),
          brand: o.brand,
          proposedLocation: o.proposedLocation,
          onboardingStatus: o.onboardingStatus,
          kycStatus: o.kycStatus,
          paymentStatus: o.paymentStatus,
          loiStatus: o.currentLoiVersion?.status ?? null,
          expectedAmount: o.expectedAmount,
          siteName: o.dashboardSite?.name ?? null,
          franchisee: o.franchisee,
          salesOwner: o.salesOwner,
        }))}
        canDelete={canDelete}
      />
    </div>
  );
}
