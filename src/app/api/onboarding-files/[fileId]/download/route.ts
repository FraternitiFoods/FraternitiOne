import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canReviewKyc, canReviewPayment, canManageOnboardingAdmin } from "@/lib/permissions";
import { getDocumentDownloadUrl } from "@/lib/storage";
import { writeAuditEvent } from "@/lib/audit";

/**
 * plan.md section 17, P1-04/P1-03: restricted download route for
 * OnboardingFile (KYC docs + payment receipts) — deliberately separate from
 * the Document vault's download route since the authorization rule is much
 * tighter (only the owning franchisee, or a reviewer role with a real stake
 * in this file kind, ever reaches these bytes). A fresh signed URL is
 * generated per request, same discipline as the vault route.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/onboarding-files/[fileId]/download">
) {
  const { fileId } = await params;
  const user = await requireUser();

  const file = await db.onboardingFile.findUnique({
    where: { id: fileId },
    include: { onboarding: { select: { franchiseeUserId: true } } },
  });
  if (!file) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const isOwner = user.role === "FRANCHISEE" && file.onboarding.franchiseeUserId === user.id;
  const isReviewer =
    canManageOnboardingAdmin(user) ||
    (file.kind === "PAYMENT_RECEIPT" ? canReviewPayment(user) : canReviewKyc(user));

  if (!isOwner && !isReviewer) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // P1-04: "Files stay unreadable to reviewers until scanStatus = CLEAN" —
  // the owning franchisee can still see their own just-uploaded file (the
  // point of the restriction is protecting reviewers/downstream systems from
  // an unscanned file, not hiding a person's own upload from themselves).
  if (isReviewer && !isOwner && file.scanStatus !== "CLEAN") {
    return NextResponse.json({ error: "File has not passed the malware scan yet." }, { status: 403 });
  }

  // P1-04: "every open of an Aadhaar file writes an AuditEvent" — unconditional.
  if (file.kind === "AADHAAR") {
    await writeAuditEvent(db, {
      actor: user,
      onboardingId: file.onboardingId,
      entityType: "OnboardingFile",
      entityId: file.id,
      action: "UPDATE",
      reference: "Aadhaar file opened",
    });
  }

  const url = await getDocumentDownloadUrl(file.b2Key, file.fileName);
  return NextResponse.redirect(url);
}
