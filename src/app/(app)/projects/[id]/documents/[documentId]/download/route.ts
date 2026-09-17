import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canViewProject } from "@/lib/permissions";
import { getDocumentDownloadUrl } from "@/lib/storage";

/**
 * Redirects to a freshly generated, time-limited signed B2 URL (NFR-05: "No
 * public bucket URLs for restricted documents"). Deliberately a Route
 * Handler, not a plain `<a href>` straight to a pre-signed URL rendered on
 * the project page: generating the URL here, per request, means the
 * authorization check (`canViewProject`) runs on every download attempt —
 * not just once at page-render time — and the project page never needs to
 * eagerly sign a URL for every document just in case it's clicked (storage
 * audit item: "Authorization potentially missing before generating a signed
 * download URL").
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/projects/[id]/documents/[documentId]/download">
) {
  const { id: projectId, documentId } = await params;
  const user = await requireUser();

  const project = await db.franchiseProject.findUnique({ where: { id: projectId } });
  if (!project || !canViewProject(user, project)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document || document.projectId !== projectId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const url = await getDocumentDownloadUrl(document.fileKey, document.fileName);
  return NextResponse.redirect(url);
}
