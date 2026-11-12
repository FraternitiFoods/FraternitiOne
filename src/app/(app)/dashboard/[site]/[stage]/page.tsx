import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewAllDashboardSites, canEditDashboardSite } from "@/lib/permissions";
import { getStageDetail, getAssignedSiteName } from "@/lib/dashboard-data";
import { PageHeader } from "@/components/page-header";
import { StepList } from "./_components/step-list";

/** Stage page (dashboard-sheet-sync-plan.md section 6): steps with status, assigned to, Shared, remark, deliverable links, expandable sub-steps. */
export default async function DashboardStagePage(props: PageProps<"/dashboard/[site]/[stage]">) {
  const user = await requireUser();
  const isFranchisee = !canViewAllDashboardSites(user);
  const { site: siteParam, stage: stageParam } = await props.params;
  const siteName = decodeURIComponent(siteParam);
  const stageNo = Number(stageParam);

  if (isFranchisee) {
    const assignedSiteName = await getAssignedSiteName(user.id);
    if (assignedSiteName !== siteName) forbidden();
  }
  if (!Number.isInteger(stageNo)) notFound();

  const stage = await getStageDetail(siteName, stageNo);
  if (!stage) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Stage ${stage.stageNo} — ${stage.stageName}`}
        subtitle={
          <Link href={`/dashboard/${encodeURIComponent(siteName)}`} className="hover:underline">
            ← {siteName}
          </Link>
        }
        isFranchisee={isFranchisee}
      />
      <StepList steps={stage.steps} editable={stage.origin === "WEBSITE" && canEditDashboardSite(user)} />
    </div>
  );
}
