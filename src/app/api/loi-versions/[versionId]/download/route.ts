import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canViewOnboarding, canCompanySign } from "@/lib/permissions";
import { getDocumentDownloadUrl } from "@/lib/storage";

/**
 * plan.md section 17: signed-download route for LOI PDFs, extended to also
 * serve the signed copy / certificate once available via `?file=signed` /
 * `?file=certificate`. Authorization re-checked on every request, same
 * discipline as the vault and OnboardingFile download routes.
 *
 * plan.md section 19 step-0 finding: this is also where
 * LoiVersion.franchiseePreviewOpenedAt / companyPreviewOpenedAt get set —
 * the OTP flow's "did this signer open the preview" precondition needs a
 * home that exists before a challenge/acceptance row does, and this route is
 * the one place both signer roles already pass through to view the exact
 * document they're about to accept.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/loi-versions/[versionId]/download">
) {
  const { versionId } = await params;
  const user = await requireUser();

  const version = await db.loiVersion.findUnique({
    where: { id: versionId },
    include: { onboarding: { select: { franchiseeUserId: true } } },
  });
  if (!version || !canViewOnboarding(user, version.onboarding)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const file = new URL(request.url).searchParams.get("file");
  // Only the base (unsigned) preview counts as "opened the preview" —
  // downloading an already-signed copy or certificate isn't the review step
  // decision 5 gates OTP verify on.
  if (!file) {
    if (user.id === version.onboarding.franchiseeUserId && !version.franchiseePreviewOpenedAt) {
      await db.loiVersion.update({ where: { id: versionId }, data: { franchiseePreviewOpenedAt: new Date() } });
    } else if (canCompanySign(user) && !version.companyPreviewOpenedAt) {
      await db.loiVersion.update({ where: { id: versionId }, data: { companyPreviewOpenedAt: new Date() } });
    }
  }
  let key: string | null = version.pdfB2Key;
  let fileName = `LOI-v${version.versionNo}.pdf`;
  if (file === "signed") {
    key = version.signedPdfB2Key;
    fileName = `LOI-v${version.versionNo}-signed.pdf`;
  } else if (file === "certificate") {
    key = version.certificateB2Key;
    fileName = `LOI-v${version.versionNo}-certificate.pdf`;
  }

  if (!key) {
    return NextResponse.json({ error: "Not available yet." }, { status: 404 });
  }

  const url = await getDocumentDownloadUrl(key, fileName);
  return NextResponse.redirect(url);
}
