import "server-only";

import { unstable_cache } from "next/cache";
import type { ComplaintStatus, Department } from "@prisma/client";
import { db } from "@/lib/db";
import { monthKeyOf, sumSalesDays, type SalesDayLike, type SalesTotals } from "@/lib/sales/aggregate";
import { dateKeyToDate, toUtcDateKey } from "@/lib/sales/parse-csv";
import { istTodayKey } from "@/lib/pos/petpooja-parse";

/**
 * plan.md section 20B — dashboard widgets (Franchisee/Sales/Admin rows on
 * /dashboard, /onboarding and /store-onboarding). Hard rule from the plan:
 * widgets are read-only views computed per request from existing tables — no
 * stored counters. Every function here runs a fresh query (or works off rows
 * the caller already fetched this request) every time it's called; nothing
 * is memoized across requests — EXCEPT `getAdminWidgets` below, which the
 * plan.md performance pass gave a narrow, explicit exception: it's a
 * portfolio-wide aggregate called identically from three places, where a few
 * seconds of staleness changes nothing anyone would act differently on. See
 * its own comment.
 *
 * This file holds only the handful of queries shared by more than one widget
 * row, so the "this month" and "open complaint" definitions can't drift
 * between the Franchisee, Sales and Admin/Management views. It does not
 * modify, and is not imported by, src/lib/sales/* or src/app/(app)/sales/*
 * (plan.md section 20's boundary) — it only reuses sales' own pure
 * aggregation helpers (sumSalesDays, monthKeyOf, dateKeyToDate) and the POS
 * layer's istTodayKey (same IST business-day clock as aggregate.ts) against
 * a fresh SalesDay query, the same read-only access any other report would
 * have.
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
 * Sums SalesDay rows for the current calendar month, where "current" is the
 * IST business month (same clock as aggregate.ts's computePeriodCards) —
 * SalesDay.date is IST-business-day-keyed even though it's stored as a UTC
 * @db.Date value, so the month boundary must be derived from IST "now", not
 * the server's UTC calendar month.
 * Pass a projectId to scope to one store (Franchisee/Sales widgets); omit it
 * for the portfolio-wide Admin/Management figure. Queries only this month's
 * rows rather than a full year of history, since a widget only needs one
 * number.
 */
export async function getSalesThisMonth(projectId?: string): Promise<SalesTotals> {
  const now = new Date();
  const thisMonthKey = monthKeyOf(istTodayKey(now));
  const monthStart = dateKeyToDate(`${thisMonthKey}-01`);
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));

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
 *
 * plan.md performance pass (navigation-slowness diagnosis): wrapped in
 * `unstable_cache` with a short revalidate window — this is a deliberate,
 * narrow exception to this file's "nothing cached" rule above, scoped to
 * this one function because it's called identically from /dashboard,
 * /board, and the weekly digest cron, and every figure here is a
 * portfolio-wide count/sum where ~20s of staleness changes no one's
 * decision. Per-task/per-record data elsewhere in the app stays fully live.
 */
export const getAdminWidgets = unstable_cache(
  async function getAdminWidgetsUncached() {
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
  },
  ["admin-widgets"],
  { revalidate: 20 }
);

/**
 * Minimal per-role widget row for internal roles that own a department
 * (DEPARTMENT_OWNERS, role-departments.ts) but have no bespoke dashboard of
 * their own (everyone except Franchisee/Sales — see InternalDashboard). Scoped
 * to Task.module/Document.category, the same fields canManageTaskModule and
 * canManageDocumentCategory (permissions.ts) already gate write access by —
 * this is a read-only count over the same scope, not a new access concept.
 */
export async function getMyDepartmentWidgets(departments: Department[]) {
  const [openTasks, documents] = await Promise.all([
    db.task.count({
      where: { module: { in: departments }, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    }),
    db.document.count({ where: { category: { in: departments } } }),
  ]);
  return { openTasks, documents };
}
