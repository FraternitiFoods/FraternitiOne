import "server-only";

import type { ComplaintStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { sumSalesDays, type SalesDayLike, type SalesTotals } from "@/lib/sales/aggregate";
import { toUtcDateKey } from "@/lib/sales/parse-csv";

/**
 * plan.md section 20B — dashboard widgets (Franchisee/Sales/Admin rows on
 * /dashboard, /onboarding and /store-onboarding). Hard rule from the plan:
 * widgets are read-only views computed per request from existing tables — no
 * stored counters, nothing cached. Every function here runs a fresh query (or
 * works off rows the caller already fetched this request) every time it's
 * called; nothing is memoized across requests.
 *
 * This file holds only the handful of queries shared by more than one widget
 * row, so the "this month" and "open complaint" definitions can't drift
 * between the Franchisee, Sales and Admin/Management views. It does not
 * modify, and is not imported by, src/lib/sales/* or src/app/(app)/sales/*
 * (plan.md section 20's boundary) — it only reuses sales' own pure
 * aggregation helpers (sumSalesDays, toUtcDateKey) against a fresh SalesDay
 * query, the same read-only access any other report would have.
 */

/** Same "open" definition already used by projects/[id]/page.tsx's complaint stat card. */
const CLOSED_COMPLAINT_STATUSES: ComplaintStatus[] = ["RESOLVED", "CLOSED"];

export const OPEN_COMPLAINT_STATUS_FILTER: { notIn: ComplaintStatus[] } = {
  notIn: CLOSED_COMPLAINT_STATUSES,
};

/** Same definition as `OPEN_COMPLAINT_STATUS_FILTER`, for filtering rows already fetched into memory. */
export function isOpenComplaintStatus(status: ComplaintStatus): boolean {
  return !CLOSED_COMPLAINT_STATUSES.includes(status);
}

/** Shared by the Franchisee dashboard and the /onboarding home page — same "latest 5" the Latest Emails card renders. */
export async function getRecentEmails(onboardingId: string, take = 5) {
  return db.notificationLog.findMany({
    where: { onboardingId },
    orderBy: { sentAt: "desc" },
    take,
  });
}

/**
 * Sums SalesDay rows for the current calendar month (UTC, matching the
 * @db.Date column's own storage convention — see parse-csv.ts's toUtcDateKey).
 * Pass a projectId to scope to one store (Franchisee/Sales widgets); omit it
 * for the portfolio-wide Admin/Management figure. Queries only this month's
 * rows rather than a full year of history, since a widget only needs one
 * number.
 */
export async function getSalesThisMonth(projectId?: string): Promise<SalesTotals> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const rows = await db.salesDay.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      date: { gte: monthStart, lt: nextMonthStart },
    },
    select: { date: true, grossSales: true, netSales: true, orders: true },
  });

  const likeRows: SalesDayLike[] = rows.map((r) => ({
    date: toUtcDateKey(r.date),
    grossSales: r.grossSales,
    netSales: r.netSales,
    orders: r.orders,
  }));
  return sumSalesDays(likeRows);
}

/**
 * plan.md section 20B — ADMIN/MANAGEMENT widget row. Every count is its own
 * direct Prisma query (no stored counters); "KYC/payment queue size" uses the
 * same `status === "SUBMITTED"` definition the KYC/Payment status filters on
 * /store-onboarding use, so this number always matches what filtering the
 * store list by that status would show.
 *
 * Moved here from dashboard/page.tsx (plan.md section 24 S/board work) so
 * the new /board founder summary screen and the weekly digest can reuse the
 * exact same portfolio-wide figures /dashboard already shows ADMIN/MANAGEMENT
 * — one function, three callers, impossible for the numbers to drift apart.
 */
export async function getAdminWidgets() {
  const [
    totalOnboardings,
    salesUsers,
    kycPending,
    loiPending,
    openComplaints,
    salesThisMonth,
    kycQueueSize,
    paymentQueueSize,
  ] = await Promise.all([
    db.storeOnboarding.count(),
    db.user.count({ where: { role: "SALES" } }),
    db.storeOnboarding.count({ where: { kycStatus: { not: "ACCEPTED" } } }),
    db.storeOnboarding.count({ where: { onboardingStatus: { not: "LOI_COMPLETE" } } }),
    db.complaint.count({ where: { status: OPEN_COMPLAINT_STATUS_FILTER } }),
    getSalesThisMonth(),
    db.storeOnboarding.count({ where: { kycStatus: "SUBMITTED" } }),
    db.storeOnboarding.count({ where: { paymentStatus: "SUBMITTED" } }),
  ]);

  return {
    totalOnboardings,
    salesUsers,
    kycPending,
    kycAccepted: totalOnboardings - kycPending,
    loiPending,
    loiComplete: totalOnboardings - loiPending,
    openComplaints,
    salesThisMonth,
    kycQueueSize,
    paymentQueueSize,
  };
}
