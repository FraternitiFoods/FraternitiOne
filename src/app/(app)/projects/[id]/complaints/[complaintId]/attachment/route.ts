import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canViewProject } from "@/lib/permissions";
import { getDocumentDownloadUrl } from "@/lib/storage";

/**
 * Mirrors projects/[id]/documents/[documentId]/download/route.ts exactly —
 * a freshly generated, time-limited signed B2 URL per request, so
 * authorization is re-checked on every download attempt, not just once at
 * page-render time.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/projects/[id]/complaints/[complaintId]/attachment">
) {
  const { id: projectId, complaintId } = await params;
  const user = await requireUser();

  const project = await db.franchiseProject.findUnique({ where: { id: projectId } });
  if (!project || !canViewProject(user, project)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const complaint = await db.complaint.findUnique({ where: { id: complaintId } });
  if (!complaint || complaint.projectId !== projectId || !complaint.attachmentFileKey) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const url = await getDocumentDownloadUrl(complaint.attachmentFileKey, complaint.attachmentFileName ?? "attachment");
  return NextResponse.redirect(url);
}
