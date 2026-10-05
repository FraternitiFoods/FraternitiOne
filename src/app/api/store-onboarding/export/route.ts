import { NextResponse } from "next/server";
import type { LoiVersionStatus, OnboardingStatus, ReviewStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import {
  canCreateOnboarding,
  canReviewKyc,
  canReviewPayment,
  canPrepareLoi,
  canCompanySign,
  canManageOnboardingAdmin,
} from "@/lib/permissions";
import { onboardingListWhere, LOI_NOT_GENERATED, type OnboardingListFilters } from "@/lib/onboarding/search";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { formatProjectCode } from "@/lib/format";
import {
  ONBOARDING_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  LOI_VERSION_STATUS_LABELS,
  formatMoney,
  formatDateOnly,
} from "@/lib/onboarding/format";
import { buildCsv } from "@/lib/csv";

// plan.md section 20D: row cap on export, same as the import side's cap.
const EXPORT_ROW_CAP = 10_000;

const CSV_HEADERS = [
  "Store Code",
  "Brand",
  "Location",
  "Franchisee Name",
  "Franchisee Email",
  "Phone",
  "Sales Person",
  "Onboarding Status",
  "KYC Status",
  "Payment Status",
  "LOI Status",
  "Expected Fee",
  "Project Code",
  "Created Date",
];

/**
 * plan.md section 20D: CSV export of /store-onboarding, status columns only
 * — never PAN, Aadhaar, bank data or file contents. Uses the exact same role
 * scoping as the list page (SALES sees only their own; every other
 * onboarding-touching role keeps full-queue visibility), applies whatever
 * search/filter params the list currently has active, caps at 10,000 rows,
 * and writes one AuditEvent recording who exported, with what filters, and
 * how many rows came out.
 */
export async function GET(request: Request) {
  const user = await requireUser();

  const canView =
    canCreateOnboarding(user) ||
    canReviewKyc(user) ||
    canReviewPayment(user) ||
    canPrepareLoi(user) ||
    canCompanySign(user) ||
    canManageOnboardingAdmin(user);

  if (!canView) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const url = new URL(request.url);
  const filters: OnboardingListFilters = {
    q: url.searchParams.get("q") ?? undefined,
    onboardingStatus: (url.searchParams.get("onboardingStatus") as OnboardingStatus | null) ?? undefined,
    kycStatus: (url.searchParams.get("kycStatus") as ReviewStatus | null) ?? undefined,
    paymentStatus: (url.searchParams.get("paymentStatus") as ReviewStatus | null) ?? undefined,
    loiStatus:
      (url.searchParams.get("loiStatus") as LoiVersionStatus | typeof LOI_NOT_GENERATED | null) ?? undefined,
  };

  const rows = await db.storeOnboarding.findMany({
    where: onboardingListWhere(user, filters),
    orderBy: { createdAt: "desc" },
    take: EXPORT_ROW_CAP,
    include: {
      franchisee: { select: { name: true, email: true } },
      salesOwner: { select: { name: true } },
      currentLoiVersion: { select: { status: true } },
      project: { select: { seq: true } },
    },
  });

  const csvRows = rows.map((o) => [
    formatOnboardingCode(o.seq),
    o.brand,
    o.proposedLocation,
    o.franchisee.name,
    o.franchisee.email ?? "",
    o.contactPhone,
    o.salesOwner.name,
    ONBOARDING_STATUS_LABELS[o.onboardingStatus],
    REVIEW_STATUS_LABELS[o.kycStatus],
    REVIEW_STATUS_LABELS[o.paymentStatus],
    o.currentLoiVersion ? LOI_VERSION_STATUS_LABELS[o.currentLoiVersion.status] : "Not Generated",
    formatMoney(o.expectedAmount),
    o.project ? formatProjectCode(o.project.seq) : "—",
    formatDateOnly(o.createdAt),
  ]);

  const csv = buildCsv(CSV_HEADERS, csvRows);

  await writeAuditEvent(db, {
    actor: user,
    entityType: "StoreOnboarding",
    entityId: "export",
    action: "EXPORT",
    newValue: { filters, rowCount: rows.length },
    source: "web",
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="store-onboardings-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
