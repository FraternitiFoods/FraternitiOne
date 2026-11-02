import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canViewSiteTracker, canDeleteTrackerEvidence } from "@/lib/permissions";
import { canDeleteEvidence } from "@/lib/tracker-calc";
import { isUsingLocalDevFallback, readLocalDevFile, getEvidenceViewUrl, deleteEvidenceObject } from "@/lib/tracker-storage";

/** site-tracker-plan.md section 5, step 4: auth-checked view. Dev fallback streams the local file directly; otherwise redirects to a short-lived signed B2 GET. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/tracker/evidence/[id]">) {
  const user = await requireUser();
  if (!canViewSiteTracker(user)) {
    return NextResponse.json({ error: "You don't have access to Site Tracker." }, { status: 403 });
  }

  const { id } = await params;
  const evidence = await db.trackerEvidence.findUnique({ where: { id } });
  if (!evidence) {
    return NextResponse.json({ error: "Evidence not found." }, { status: 404 });
  }

  if (isUsingLocalDevFallback()) {
    try {
      const buffer = await readLocalDevFile(evidence.storageKey);
      return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": evidence.mimeType } });
    } catch {
      return NextResponse.json({ error: "File missing from local dev storage." }, { status: 404 });
    }
  }

  const url = await getEvidenceViewUrl({ key: evidence.storageKey });
  return NextResponse.redirect(url);
}

/** site-tracker-plan.md section 4 rule 3: Admin only, and never the last evidence on a Completed non-legacy step. */
export async function DELETE(_request: NextRequest, { params }: RouteContext<"/api/tracker/evidence/[id]">) {
  const user = await requireUser();
  if (!canDeleteTrackerEvidence(user)) {
    return NextResponse.json({ error: "Only an Admin can delete evidence." }, { status: 403 });
  }

  const { id } = await params;
  const evidence = await db.trackerEvidence.findUnique({
    where: { id },
    include: { siteStep: { include: { site: true, step: true, _count: { select: { evidence: true } } } } },
  });
  if (!evidence) {
    return NextResponse.json({ error: "Evidence not found." }, { status: 404 });
  }

  const allowed = canDeleteEvidence({
    status: evidence.siteStep.status,
    legacyCompleted: evidence.siteStep.legacyCompleted,
    evidenceCount: evidence.siteStep._count.evidence,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Can't delete the last evidence of a Completed step — change its status first." },
      { status: 400 }
    );
  }

  await db.$transaction(async (tx) => {
    await tx.trackerEvidence.delete({ where: { id } });
    await writeAuditEvent(tx, {
      actor: user,
      entityType: "TrackerEvidence",
      entityId: id,
      action: "DELETE",
      oldValue: { fileName: evidence.fileName, mimeType: evidence.mimeType, sizeBytes: evidence.sizeBytes },
      reference: `"${evidence.siteStep.step.code} ${evidence.siteStep.step.name}" on "${evidence.siteStep.site.name}"`,
    });
  });

  await deleteEvidenceObject(evidence.storageKey).catch((err) => {
    console.error("Failed to delete evidence object from storage (DB row already removed):", err);
  });

  const remaining = await db.trackerEvidence.count({ where: { siteStepId: evidence.siteStepId } });
  return NextResponse.json({ evidenceCount: remaining });
}
