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
import { onboardingListWhere } from "@/lib/onboarding/search";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { StoreOnboardingList } from "./store-onboarding-list";

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

  // plan.md section 20D — SALES only sees their own onboardings; every other
  // onboarding-touching role keeps the existing full-queue visibility.
  const where = onboardingListWhere(user);

  // plan.md section 20B — summary strip over the *whole* role-scoped queue,
  // not just the rows currently on screen, so it's computed from its own
  // aggregate counts rather than the `onboardings` array below — otherwise
  // capping the table with `take` would silently make these numbers wrong
  // once there are more than 50 onboardings. Run everything in parallel so
  // the cap doesn't cost any extra wall-clock time.
  const [onboardings, total, kycPending, paymentPending, loiPending, converted] = await Promise.all([
    db.storeOnboarding.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        franchisee: { select: { name: true, email: true } },
        salesOwner: { select: { name: true } },
        currentLoiVersion: { select: { status: true } },
      },
      // List view, not an export — cap the row count so this stays cheap to
      // query/render/serialize as the number of onboardings grows.
      take: 50,
    }),
    db.storeOnboarding.count({ where }),
    db.storeOnboarding.count({ where: { ...where, kycStatus: { not: "ACCEPTED" } } }),
    db.storeOnboarding.count({ where: { ...where, paymentStatus: { not: "ACCEPTED" } } }),
    db.storeOnboarding.count({ where: { ...where, onboardingStatus: { not: "LOI_COMPLETE" } } }),
    db.storeOnboarding.count({ where: { ...where, onboardingStatus: "LOI_COMPLETE" } }),
  ]);

  const canDelete = canManageOnboardingAdmin(user);

  const summary = {
    total,
    kycPending,
    paymentPending,
    loiPending,
    converted,
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
          projectId: o.projectId,
          franchisee: o.franchisee,
          salesOwner: o.salesOwner,
        }))}
        canDelete={canDelete}
      />
    </div>
  );
}
