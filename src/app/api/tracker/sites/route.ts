import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { canViewSiteTracker } from "@/lib/permissions";
import { getAllSitesProgress } from "@/lib/tracker-data";

/** site-tracker-plan.md section 4 helper #2, consumed by the site selector and the "All sites" tab. */
export async function GET() {
  const user = await requireUser();
  if (!canViewSiteTracker(user)) {
    return NextResponse.json({ error: "You don't have access to Site Tracker." }, { status: 403 });
  }

  const sites = await getAllSitesProgress();
  return NextResponse.json({ sites });
}
