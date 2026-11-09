import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewAllDashboardSites } from "@/lib/permissions";
import { getSiteDetail, getAssignedSiteName } from "@/lib/dashboard-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

/**
 * Site page (dashboard-sheet-sync-plan.md section 6): overall %, Drive link,
 * the 13 stages as cards, department folder links. A franchisee can only
 * reach their own assigned site — enforced here server-side, not just by
 * hiding the link (dashboard-sheet-sync-plan.md section 8 acceptance check).
 */
export default async function DashboardSitePage(props: PageProps<"/dashboard/[site]">) {
  const user = await requireUser();
  const isFranchisee = !canViewAllDashboardSites(user);
  const { site: siteParam } = await props.params;
  const siteName = decodeURIComponent(siteParam);

  if (isFranchisee) {
    const assignedSiteName = await getAssignedSiteName(user.id);
    if (assignedSiteName !== siteName) forbidden();
  }

  const site = await getSiteDetail(siteName);
  if (!site) notFound();

  const overallPct = Math.round(site.overall.pct * 100);

  return (
    <div className="space-y-6">
      <PageHeader
        title={site.name}
        subtitle={site.lastSyncedAt ? `Last synced ${formatDateTime(site.lastSyncedAt)}` : "Not yet synced"}
        isFranchisee={isFranchisee}
        action={
          site.driveFolderUrl ? (
            <a
              href={site.driveFolderUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-primary hover:underline"
            >
              Drive folder ↗
            </a>
          ) : undefined
        }
      />

      <Card>
        <CardContent>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-muted-foreground">Overall progress</span>
            <span className="text-lg font-semibold">{overallPct}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400"
              style={{ width: `${overallPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {site.overall.completed} completed · {site.overall.inProgress} in progress · {site.overall.notStarted} not
            started · {site.overall.notRequired} not required
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {site.stages.map((stage) => {
          const pct = Math.round(stage.pct * 100);
          return (
            <Link key={stage.stageNo} href={`/dashboard/${encodeURIComponent(site.name)}/${stage.stageNo}`}>
              <Card className="h-full transition-colors hover:ring-foreground/20">
                <CardHeader>
                  <CardTitle className="text-sm">Stage {stage.stageNo}</CardTitle>
                  <p className="truncate text-xs text-muted-foreground">{stage.stageName}</p>
                </CardHeader>
                <CardContent>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {stage.completed}/{stage.applicable}
                    </span>
                    <span className="text-sm font-semibold">{pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {site.deptLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Department links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {site.deptLinks.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="block text-sm text-primary hover:underline"
              >
                {link.department} — {link.stageFolderName}
              </a>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
