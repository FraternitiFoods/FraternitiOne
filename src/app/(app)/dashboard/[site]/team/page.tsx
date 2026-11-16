import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canAssignDashboardTasks } from "@/lib/permissions";
import { getTeamData } from "@/lib/dashboard-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TeamManager } from "./_components/team-manager";

/**
 * Admin-only "Team" page of a website-created Dashboard site (plan.md section
 * 12): who works on which tasks. Assigning a whole stage ticks all its tasks;
 * individual tasks can be unticked. Whatever is saved here decides which stages
 * a person can open and which tasks they can edit.
 */
export default async function DashboardTeamPage(props: PageProps<"/dashboard/[site]/team">) {
  const user = await requireUser();
  if (!canAssignDashboardTasks(user)) forbidden();

  const { site: siteParam } = await props.params;
  const siteName = decodeURIComponent(siteParam);
  const team = await getTeamData(siteName);
  if (!team) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Team — ${team.site.name}`}
        subtitle={
          <Link href={`/dashboard/${encodeURIComponent(team.site.name)}`} className="hover:underline">
            ← {team.site.name}
          </Link>
        }
        isFranchisee={false}
      />
      {team.site.origin !== "WEBSITE" ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Tasks can only be assigned on website-created sites. This site is synced from the sheet, so its tasks are read-only here.
          </CardContent>
        </Card>
      ) : (
        <TeamManager
          siteId={team.site.id}
          stages={team.stages}
          people={team.people}
          initialAssigned={team.assignedByUser}
        />
      )}
    </div>
  );
}
