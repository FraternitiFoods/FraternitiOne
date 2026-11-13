import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewAllDashboardSites } from "@/lib/permissions";
import { canOpenStage } from "@/lib/dashboard-access";
import { getStageDetail, getAssignedSiteName, getAssignedStageNos, getAssignedStepIds } from "@/lib/dashboard-data";
import { PageHeader } from "@/components/page-header";
import { StepList } from "./_components/step-list";

/**
 * Stage page (dashboard-sheet-sync-plan.md section 6): steps with status, assigned to, Shared, remark, deliverable links, expandable sub-steps.
 * Access (plan.md section 12): Admin opens every stage; a franchisee only their own site; any other internal
 * user only a stage where Admin gave them >= 1 task — a pasted URL to any other stage is refused here, not
 * just hidden on the site page. Inside an opened stage everyone sees all tasks; only the user's own are editable.
 */
export default async function DashboardStagePage(props: PageProps<"/dashboard/[site]/[stage]">) {
  const user = await requireUser();
  const isFranchisee = !canViewAllDashboardSites(user);
  const isAdmin = user.role === "ADMIN";
  const { site: siteParam, stage: stageParam } = await props.params;
  const siteName = decodeURIComponent(siteParam);
  const stageNo = Number(stageParam);

  if (isFranchisee) {
    const assignedSiteName = await getAssignedSiteName(user.id);
    if (assignedSiteName !== siteName) forbidden();
  }
  if (!Number.isInteger(stageNo)) notFound();

  const stage = await getStageDetail(siteName, stageNo, { includeAssignees: !isFranchisee });
  if (!stage) notFound();

  const assignedStageNos = isAdmin || isFranchisee ? new Set<number>() : await getAssignedStageNos(user.id, stage.siteId);
  if (!canOpenStage({ role: user.role, stageNo, assignedStageNos })) forbidden();

  const myStepIds =
    isAdmin || isFranchisee ? new Set<string>() : await getAssignedStepIds(user.id, stage.siteId, stageNo);
  const isWebsiteSite = stage.origin === "WEBSITE";

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
      <StepList
        steps={stage.steps}
        editAll={isWebsiteSite && isAdmin}
        editableStepIds={isWebsiteSite ? [...myStepIds] : []}
        highlightStepIds={[...myStepIds]}
      />
    </div>
  );
}
