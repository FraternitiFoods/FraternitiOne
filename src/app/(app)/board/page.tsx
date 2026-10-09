import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewBoardSummary } from "@/lib/permissions";
import { getBoardSummary } from "@/lib/board-summary";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEPARTMENT_LABELS, formatDateTime } from "@/lib/format";
import { formatPaiseAsRupees } from "@/lib/sales/format";

/**
 * Founder/board single-screen summary — recombines figures already shown on
 * /dashboard (portfolio health, onboarding funnel, sales this month, open
 * complaints) and /delays (lateness) into one at-a-glance view, since the
 * founder/board shouldn't have to piece those together from three screens.
 * ADMIN/MANAGEMENT only (`canViewBoardSummary`), same gate as /delays.
 */
export default async function BoardSummaryPage() {
  const user = await requireUser();
  if (!canViewBoardSummary(user)) {
    redirect("/dashboard");
  }

  const summary = await getBoardSummary();
  const { health, onboarding, delays } = summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Board Summary"
        subtitle="Portfolio health, pipeline, and delivery — one screen, no drill-down needed."
        isFranchisee={false}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Projects" value={health.total} caption="All lifecycle stages" />
        <StatCard label="On Track" value={health.onTrack} caption="Green health" captionClassName="text-emerald-600" />
        <StatCard label="At Risk" value={health.atRisk} caption="Needs action" captionClassName="text-amber-600" />
        <StatCard label="Critical" value={health.critical} caption="Escalated" captionClassName="text-red-600" />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Onboarding Pipeline
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Onboardings" value={onboarding.totalOnboardings} />
          <StatCard label="KYC Pending" value={onboarding.kycPending} />
          <StatCard label="LOI Pending" value={onboarding.loiPending} />
          <StatCard
            label="Open Complaints"
            value={onboarding.openComplaints}
            caption={onboarding.openComplaints > 0 ? "Needs attention" : "All clear"}
            captionClassName={onboarding.openComplaints > 0 ? "text-amber-600" : "text-emerald-600"}
          />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Revenue</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Sales This Month"
            value={formatPaiseAsRupees(onboarding.salesThisMonth.netSales)}
            caption={`${onboarding.salesThisMonth.orders} orders · net, portfolio-wide`}
          />
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Delivery & Delays</h2>
          <Link href="/delays" className="text-sm underline underline-offset-4 hover:text-foreground">
            View full delay breakdown →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Running On Time" value={delays.runningOnTrack} captionClassName="text-emerald-600" />
          <StatCard
            label="Running Overdue"
            value={delays.runningOverdue}
            captionClassName={delays.runningOverdue > 0 ? "text-red-600" : undefined}
          />
          <StatCard label="Finished On Time" value={delays.finishedOnTime} captionClassName="text-emerald-600" />
          <StatCard
            label="Finished Late"
            value={delays.finishedLate}
            captionClassName={delays.finishedLate > 0 ? "text-amber-600" : undefined}
          />
          <StatCard label="Avg Days Overdue" value={delays.averageDaysOverdue} caption="Across open overdue tasks" />
        </div>

        {delays.topLate.length > 0 && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Most overdue right now</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {delays.topLate.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {t.storeLabel} — {t.title} ({DEPARTMENT_LABELS[t.module]})
                  </span>
                  <span className="font-medium text-red-600">{t.daysOverdue}d late</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Generated at {formatDateTime(summary.generatedAt.toISOString())}</p>
    </div>
  );
}
