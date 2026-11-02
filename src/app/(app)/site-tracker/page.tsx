import { requireSiteTrackerUser } from "@/lib/site-tracker-access";
import { canEditSiteTracker } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { SiteTrackerApp } from "./_components/site-tracker-app";

/** site-tracker-plan.md section 6 — single page: site selector, Tracker | All sites tabs, summary, filters, sections. */
export default async function SiteTrackerPage() {
  const user = await requireSiteTrackerUser();

  return (
    <div className="space-y-6">
      <PageHeader title="Site Tracker" subtitle="Construction progress by site." isFranchisee={false} />
      <SiteTrackerApp
        currentUserName={user.name}
        canEdit={canEditSiteTracker(user)}
        isAdmin={user.role === "ADMIN"}
      />
    </div>
  );
}
