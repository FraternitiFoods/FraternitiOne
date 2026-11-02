import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canEditSiteTracker } from "@/lib/permissions";
import { canMarkCompleted } from "@/lib/tracker-calc";

const nullableTextSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const PatchSchema = z.object({
  siteId: z.string().min(1),
  stepId: z.string().min(1),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "NOT_REQUIRED"]).optional(),
  assignee: nullableTextSchema,
  remark: nullableTextSchema,
  notRequiredReason: nullableTextSchema,
});

/**
 * site-tracker-plan.md section 4 rule 1 and milestone T3: status/assignee/
 * remark/notRequiredReason edits. Lazily creates the TrackerSiteStep row
 * (section 3: "no row = NOT_STARTED") and rejects COMPLETED with no
 * evidence server-side, not just in the UI — evidence is uploaded (and its
 * TrackerEvidence row created) via /api/tracker/evidence/confirm in an
 * earlier request, so by the time this runs the count already reflects it.
 */
export async function PATCH(request: NextRequest) {
  const user = await requireUser();
  if (!canEditSiteTracker(user)) {
    return NextResponse.json({ error: "You don't have permission to edit Site Tracker." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let input: z.infer<typeof PatchSchema>;
  try {
    input = PatchSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid request body.", issues: err.issues }, { status: 400 });
    }
    throw err;
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

  const existing = await db.trackerSiteStep.findUnique({
    where: { siteId_stepId: { siteId: input.siteId, stepId: input.stepId } },
    include: { _count: { select: { evidence: true } } },
  });

  if (input.status === "COMPLETED") {
    const evidenceCount = existing?._count.evidence ?? 0;
    const legacyCompleted = existing?.legacyCompleted ?? false;
    if (!canMarkCompleted({ evidenceCount, legacyCompleted })) {
      return NextResponse.json(
        { error: "Add at least one photo or video before marking this step Completed." },
        { status: 400 }
      );
    }
  }

  const statusChanging = input.status !== undefined && input.status !== (existing?.status ?? "NOT_STARTED");
  const becomingCompleted = statusChanging && input.status === "COMPLETED";
  const leavingCompleted = statusChanging && existing?.status === "COMPLETED" && input.status !== "COMPLETED";

  const data: {
    status?: typeof input.status;
    assignee?: string | null;
    remark?: string | null;
    notRequiredReason?: string | null;
    completedAt?: Date | null;
    completedById?: string | null;
    updatedById: string;
  } = { updatedById: user.id };

  if (input.status !== undefined) data.status = input.status;
  if (input.assignee !== undefined) data.assignee = input.assignee;
  if (input.remark !== undefined) data.remark = input.remark;
  if (input.notRequiredReason !== undefined) data.notRequiredReason = input.notRequiredReason;
  if (becomingCompleted) {
    data.completedAt = new Date();
    data.completedById = user.id;
  } else if (leavingCompleted) {
    data.completedAt = null;
    data.completedById = null;
  }

  const oldValue = existing
    ? {
        status: existing.status,
        assignee: existing.assignee,
        remark: existing.remark,
        notRequiredReason: existing.notRequiredReason,
      }
    : { status: "NOT_STARTED", assignee: null, remark: null, notRequiredReason: null };

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.trackerSiteStep.upsert({
      where: { siteId_stepId: { siteId: input.siteId, stepId: input.stepId } },
      update: data,
      create: {
        siteId: input.siteId,
        stepId: input.stepId,
        status: input.status ?? "NOT_STARTED",
        assignee: input.assignee ?? null,
        remark: input.remark ?? null,
        notRequiredReason: input.notRequiredReason ?? null,
        completedAt: data.completedAt,
        completedById: data.completedById,
        updatedById: user.id,
      },
      include: { _count: { select: { evidence: true } } },
    });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "TrackerSiteStep",
      entityId: row.id,
      action: existing ? "UPDATE" : "CREATE",
      oldValue,
      newValue: {
        status: row.status,
        assignee: row.assignee,
        remark: row.remark,
        notRequiredReason: row.notRequiredReason,
      },
      reference: `"${step.code} ${step.name}" on "${site.name}"`,
    });

    return row;
  });

  return NextResponse.json({
    siteStepId: updated.id,
    status: updated.status,
    assignee: updated.assignee,
    remark: updated.remark,
    notRequiredReason: updated.notRequiredReason,
    completedAt: updated.completedAt,
    legacyCompleted: updated.legacyCompleted,
    evidenceCount: updated._count.evidence,
  });
}
