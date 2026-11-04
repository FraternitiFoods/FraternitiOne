import { requireSiteTrackerUser } from "@/lib/site-tracker-access";
import { canEditSiteTracker } from "@/lib/permissions";
import { getAllSitesProgress, getSiteTrackerSummary, type SiteTrackerSummary } from "@/lib/tracker-data";
import { PageHeader } from "@/components/page-header";
import { SiteTrackerApp } from "./_components/site-tracker-app";
import type { SiteSummary } from "./_components/types";

/** Dates cross the server/client boundary as Date instances via React's flight protocol, but the client types (matching what /api/tracker/sites/[id] returns via NextResponse.json) expect ISO strings — mirror that serialization here so the SSR-seeded shape matches what a client-side fetch would have produced. */
function serializeSummary(summary: SiteTrackerSummary | null): SiteSummary | null {
  if (!summary) return null;
  return {
    ...summary,
    sections: summary.sections.map((section) => ({
      ...section,
      steps: section.steps.map((step) => ({
        ...step,
        completedAt: step.completedAt ? step.completedAt.toISOString() : null,
        updatedAt: step.updatedAt ? step.updatedAt.toISOString() : null,
        evidence: step.evidence.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
      })),
    })),
  };
}

/** site-tracker-plan.md section 6 — single page: site selector, Tracker | All sites tabs, summary, filters, sections. */
export default async function SiteTrackerPage() {
  const user = await requireSiteTrackerUser();

  const initialSites = await getAllSitesProgress();
  const firstSiteId = initialSites[0]?.site.id;
  const initialSummary = firstSiteId ? await getSiteTrackerSummary(firstSiteId) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Site Tracker" subtitle="Construction progress by site." isFranchisee={false} />
      <SiteTrackerApp
        currentUserName={user.name}
        canEdit={canEditSiteTracker(user)}
        isAdmin={user.role === "ADMIN"}
        initialSites={initialSites}
        initialSummary={serializeSummary(initialSummary)}
      />
    </div>
  );
}
