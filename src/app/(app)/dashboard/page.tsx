import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewAllDashboardSites, canTriggerDashboardSync } from "@/lib/permissions";
import { getDashboardRanking, getAssignedSiteName } from "@/lib/dashboard-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardSyncButton } from "./_components/dashboard-sync-button";

/** Dashboard home (dashboard-sheet-sync-plan.md section 6): site-wise ranking, high to low. */
export default async function DashboardHomePage() {
  const user = await requireUser();
  const isFranchisee = !canViewAllDashboardSites(user);

  if (isFranchisee) {
    const assignedSiteName = await getAssignedSiteName(user.id);
    if (assignedSiteName) redirect(`/dashboard/${encodeURIComponent(assignedSiteName)}`);

    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" isFranchisee={isFranchisee} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No site has been assigned to your account yet. Ask an Admin to assign one.
          </CardContent>
        </Card>
      </div>
    );
  }

  const ranking = await getDashboardRanking();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Site-wise progress across all 13 stages, synced from the Site Drawing Updates sheet."
        isFranchisee={isFranchisee}
        action={canTriggerDashboardSync(user) ? <DashboardSyncButton /> : undefined}
      />

      {ranking.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No sites synced yet. Run a sync to pull data from the sheet.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {ranking.map((site, i) => {
          const pct = Math.round(site.pct * 100);
          return (
            <Link key={site.name} href={`/dashboard/${encodeURIComponent(site.name)}`} className="block">
              <Card className="transition-colors hover:ring-foreground/20">
                <CardContent className="flex items-center gap-4">
                  <span className="w-6 shrink-0 text-sm font-medium text-muted-foreground">#{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{site.name}</span>
                      <span className="shrink-0 text-sm font-semibold">{pct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {site.completed} of {site.total} steps complete
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
