import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { Lock } from "lucide-react";
import {
  canViewAllDashboardSites,
  canEditDashboardSite,
  canDeleteDashboardSite,
  canAssignDashboardTasks,
} from "@/lib/permissions";
import { openableStageNos } from "@/lib/dashboard-access";
import { getSiteDetail, getAssignedSiteName, getAssignedStageNos } from "@/lib/dashboard-data";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { linkifyText } from "@/lib/dashboard-site-input";
import { EditSiteDialog } from "../_components/edit-site-dialog";
import { DeleteSiteDialog } from "../_components/delete-site-dialog";

/**
 * Site page (dashboard-sheet-sync-plan.md section 6): overall %, Drive link,
 * the 13 stages as cards, department folder links. A franchisee can only
 * reach their own assigned site — enforced here server-side, not just by
 * hiding the link (dashboard-sheet-sync-plan.md section 8 acceptance check).
 * Every internal user sees every stage card with its progress; a card is a
 * link only for a stage they may open (plan.md section 12) — the stage page
 * re-checks, so a typed URL gets the same answer.
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
  const isWebsiteSite = site.origin === "WEBSITE";
  const canEdit = isWebsiteSite && canEditDashboardSite(user);
  const canDelete = isWebsiteSite && canDeleteDashboardSite(user);
  const canAssign = isWebsiteSite && canAssignDashboardTasks(user);

  const assignedStageNos =
    user.role === "ADMIN" || isFranchisee ? new Set<number>() : await getAssignedStageNos(user.id, site.id);
  const openable = openableStageNos({
    role: user.role,
    allStageNos: site.stages.map((s) => s.stageNo),
    assignedStageNos,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={site.name}
        subtitle={
          isWebsiteSite ? (
            <Badge variant="outline">Not synced with sheet</Badge>
          ) : site.lastSyncedAt ? (
            `Last synced ${formatDateTime(site.lastSyncedAt)}`
          ) : (
            "Not yet synced"
          )
        }
        isFranchisee={isFranchisee}
        action={
          site.driveFolderUrl || canEdit || canDelete || canAssign ? (
            <div className="flex items-center gap-3">
              {site.driveFolderUrl && (
                <a
                  href={site.driveFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Drive folder ↗
                </a>
              )}
              {canAssign && (
                <Button
                  nativeButton={false}
                  size="sm"
                  variant="outline"
                  render={<Link href={`/dashboard/${encodeURIComponent(site.name)}/team`}>Team</Link>}
                />
              )}
              {canEdit && (
                <EditSiteDialog
                  site={{
                    id: site.id,
                    name: site.name,
                    driveFolderUrl: site.driveFolderUrl,
                    deptLinksText: site.deptLinksText,
                  }}
                  trigger={
                    <Button size="sm" variant="outline">
                      Edit details
                    </Button>
                  }
                />
              )}
              {canDelete && (
                <DeleteSiteDialog
                  site={{ id: site.id, name: site.name }}
                  trigger={
                    <Button size="sm" variant="destructive">
                      Delete site
                    </Button>
                  }
                />
              )}
            </div>
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
          const isOpenable = openable.has(stage.stageNo);
          const card = (
            <Card
              className={
                isOpenable ? "h-full transition-colors hover:ring-foreground/20" : "h-full opacity-60"
              }
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span>Stage {stage.stageNo}</span>
                  {!isOpenable && <Lock className="size-3.5 text-muted-foreground" aria-label="Not assigned to you" />}
                </CardTitle>
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
          );
          return isOpenable ? (
            <Link key={stage.stageNo} href={`/dashboard/${encodeURIComponent(site.name)}/${stage.stageNo}`}>
              {card}
            </Link>
          ) : (
            <div key={stage.stageNo} aria-disabled="true" data-locked="true">
              {card}
            </div>
          );
        })}
      </div>

      {site.deptLinksText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Department links</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap break-words">
              {linkifyText(site.deptLinksText).map((seg, i) =>
                seg.href ? (
                  <a key={i} href={seg.href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {seg.text}
                  </a>
                ) : (
                  <span key={i}>{seg.text}</span>
                )
              )}
            </p>
          </CardContent>
        </Card>
      )}

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
