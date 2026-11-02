import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditSiteTracker } from "@/lib/permissions";
import { validateEvidenceUpload, evidenceExtensionForMime } from "@/lib/tracker-evidence-rules";
import { buildTrackerEvidenceKey, getEvidenceUploadUrl } from "@/lib/tracker-storage";

const PresignSchema = z.object({
  siteId: z.string().min(1),
  stepId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
});

/** site-tracker-plan.md section 5, step 1: validate auth/role/MIME/size, return a presigned PUT target. No DB write — the TrackerSiteStep/TrackerEvidence rows are only created once /confirm verifies the upload actually landed. */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!canEditSiteTracker(user)) {
    return NextResponse.json({ error: "You don't have permission to edit Site Tracker." }, { status: 403 });
  }

  let input: z.infer<typeof PresignSchema>;
  try {
    input = PresignSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid request body.", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const [site, step] = await Promise.all([
    db.site.findUnique({ where: { id: input.siteId } }),
    db.trackerStep.findUnique({ where: { id: input.stepId } }),
  ]);
  if (!site || !site.usedInTracker) {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  if (!step || !step.isActive) {
    return NextResponse.json({ error: "Step not found." }, { status: 404 });
  }

  const validation = validateEvidenceUpload({ mimeType: input.mimeType, sizeBytes: input.size });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const storageKey = buildTrackerEvidenceKey({
    siteId: input.siteId,
    stepId: input.stepId,
    extension: evidenceExtensionForMime(input.mimeType),
  });

  try {
    const { uploadUrl, devLocal } = await getEvidenceUploadUrl({ key: storageKey, contentType: input.mimeType });
    return NextResponse.json({ uploadUrl, storageKey, devLocal });
  } catch (err) {
    console.error("Tracker evidence presign error:", err);
    return NextResponse.json(
      { error: "File storage is not configured. Ask an Admin to set up B2 credentials." },
      { status: 500 }
    );
  }
}
