import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { canViewSiteTracker } from "@/lib/permissions";
import { getSiteTrackerSummary } from "@/lib/tracker-data";

/** site-tracker-plan.md section 4 helper #1 — the full per-site tracker (sections/steps/counts) the main page renders. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/tracker/sites/[siteId]">) {
  const user = await requireUser();
  if (!canViewSiteTracker(user)) {
    return NextResponse.json({ error: "You don't have access to Site Tracker." }, { status: 403 });
  }

  const { siteId } = await params;
  const summary = await getSiteTrackerSummary(siteId);
  if (!summary) {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }

  return NextResponse.json(summary);
}
