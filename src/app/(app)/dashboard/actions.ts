"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canCreateDashboardSite, canEditDashboardSite } from "@/lib/permissions";
import { getDashboardStepTemplate } from "@/lib/dashboard-template";
import {
  DEFAULT_STEP_ASSIGNEE,
  createDashboardSiteSchema,
  normalizeSiteName,
  updateDashboardSiteDetailsSchema,
  updateDashboardStepSchema,
} from "@/lib/dashboard-site-input";

export type ActionState = { error?: string; success?: boolean } | undefined;

const NO_PERMISSION = "You don't have permission to do this.";

/** Dynamic-segment patterns need an explicit type; pages are dynamic (cookies), this just drops the client router cache for them. */
function revalidateDashboard() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/[site]", "page");
  revalidatePath("/dashboard/[site]/[stage]", "page");
}

/**
 * Creates a website-owned Dashboard site with the full step template
 * (every step assigned to "Admin", every leaf NOT_STARTED). Admin only.
 * One transaction: site + ~466 steps (single createMany) + audit event.
 * origin = WEBSITE keeps the sheet sync's hands off it (commit.ts).
 */
export async function createDashboardSite(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canCreateDashboardSite(user)) return { error: NO_PERMISSION };

  const parsed = createDashboardSiteSchema.safeParse({
    name: formData.get("name"),
    driveFolderUrl: formData.get("driveFolderUrl"),
    deptLinksText: formData.get("deptLinksText"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  // One parallel round trip. Case/whitespace-insensitive, across ALL rows
  // (including archived sheet sites): the sync matches by this same normalised
  // name, so a near-duplicate would be adopted/skipped confusingly later.
  // The shared Site table (Site BOQ + Site Tracker) has a unique name too, and
  // the tracker row created below must not collide with / hijack an existing one.
  const [existingSites, trackerNameTaken, siteSortMax] = await Promise.all([
    db.dashboardSite.findMany({ select: { name: true, sortOrder: true } }),
    db.site.findFirst({ where: { name: { equals: data.name, mode: "insensitive" } }, select: { id: true } }),
    db.site.aggregate({ _max: { sortOrder: true } }),
  ]);
  const wanted = normalizeSiteName(data.name);
  if (existingSites.some((s) => normalizeSiteName(s.name) === wanted)) {
    return { error: "A site with this name already exists." };
  }
  if (trackerNameTaken) return { error: "A tracker/BOQ site with this name already exists." };
  // A lost race here only means two sites share a sortOrder, which is harmless.
  const nextSortOrder = existingSites.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
  const nextTrackerSortOrder = (siteSortMax._max.sortOrder ?? -1) + 1;

  const template = getDashboardStepTemplate();

  try {
    await db.$transaction(
      async (tx) => {
        const site = await tx.dashboardSite.create({
          data: {
            name: data.name,
            origin: "WEBSITE",
            driveFolderUrl: data.driveFolderUrl,
            deptLinksText: data.deptLinksText,
            sortOrder: nextSortOrder,
            isActive: true,
          },
        });

        // Makes the site appear in Site Tracker (dropdown + All sites). Tracker
        // steps are lazy per-site rows, so this one row is all it needs. Tracker
        // only (usedInBoq false); `WEB-` sourceKey as in site-boq/sites/actions.ts.
        const trackerSite = await tx.site.create({
          data: {
            sourceKey: `WEB-${randomUUID()}`,
            name: data.name,
            sortOrder: nextTrackerSortOrder,
            usedInBoq: false,
            usedInTracker: true,
          },
          select: { id: true },
        });

        await tx.dashboardStep.createMany({
          data: template.map((step) => ({
            siteId: site.id,
            stageNo: step.stageNo,
            stageName: step.stageName,
            stepKey: step.stepKey,
            parentKey: step.parentKey,
            label: step.label,
            sortOrder: step.sortOrder,
            isParent: step.isParent,
            assignedTo: DEFAULT_STEP_ASSIGNEE,
            status: step.isParent ? null : ("NOT_STARTED" as const),
            shared: false,
            deliverables: [],
          })),
        });

        await writeAuditEvent(tx, {
          actor: user,
          entityType: "DashboardSite",
          entityId: site.id,
          action: "CREATE",
          newValue: {
            name: data.name,
            driveFolderUrl: data.driveFolderUrl,
            deptLinksText: data.deptLinksText,
            steps: template.length,
            trackerSiteId: trackerSite.id,
          },
          reference: "Created on the website (Dashboard)",
        });
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
  } catch (e) {
    // Lost a race with a concurrent create of the same exact name (unique index).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "A site with this name already exists." };
    }
    throw e;
  }

  revalidateDashboard();
  revalidatePath("/site-tracker"); // the new tracker site must show in its dropdown / All sites tab
  redirect(`/dashboard/${encodeURIComponent(data.name)}`);
}

/** Drive folder link + free-text department links of a website-created site. Sheet sites' Drive link is sheet-owned, so they're refused. */
export async function updateDashboardSiteDetails(
  siteId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditDashboardSite(user)) return { error: NO_PERMISSION };

  const parsed = updateDashboardSiteDetailsSchema.safeParse({
    driveFolderUrl: formData.get("driveFolderUrl"),
    deptLinksText: formData.get("deptLinksText"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const existing = await db.dashboardSite.findUnique({
    where: { id: siteId },
    select: { id: true, origin: true, driveFolderUrl: true, deptLinksText: true },
  });
  if (!existing) return { error: "Site not found." };
  if (existing.origin !== "WEBSITE") return { error: "Only website-created sites can be edited here." };

  await db.$transaction(async (tx) => {
    await tx.dashboardSite.update({
      where: { id: siteId },
      data: { driveFolderUrl: data.driveFolderUrl, deptLinksText: data.deptLinksText },
    });
    await writeAuditEvent(tx, {
      actor: user,
      entityType: "DashboardSite",
      entityId: siteId,
      action: "UPDATE",
      oldValue: { driveFolderUrl: existing.driveFolderUrl, deptLinksText: existing.deptLinksText },
      newValue: { driveFolderUrl: data.driveFolderUrl, deptLinksText: data.deptLinksText },
      reference: "Edited site details (Dashboard)",
    });
  });

  revalidateDashboard();
  return { success: true };
}

/**
 * Status + remark of one leaf step of a website-created site. Called straight
 * from the client (optimistic UI), so it validates everything itself:
 * admin, step exists, leaf only (parents derive from children), site is
 * WEBSITE-owned (sheet sites are overwritten by the next sync).
 */
export async function updateDashboardStep(stepId: string, status: string, remark: string | null): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditDashboardSite(user)) return { error: NO_PERMISSION };

  const parsed = updateDashboardStepSchema.safeParse({ status, remark });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const step = await db.dashboardStep.findUnique({
    where: { id: stepId },
    select: { id: true, isParent: true, status: true, remark: true, label: true, site: { select: { id: true, origin: true } } },
  });
  if (!step) return { error: "Step not found." };
  if (step.isParent) return { error: "A parent step's status is derived from its sub-steps." };
  if (step.site.origin !== "WEBSITE") return { error: "Only website-created sites can be edited here." };

  if (step.status === data.status && (step.remark ?? null) === data.remark) return { success: true };

  await db.$transaction(async (tx) => {
    await tx.dashboardStep.update({ where: { id: stepId }, data: { status: data.status, remark: data.remark } });
    await writeAuditEvent(tx, {
      actor: user,
      entityType: "DashboardStep",
      entityId: stepId,
      action: "UPDATE",
      oldValue: { status: step.status, remark: step.remark },
      newValue: { status: data.status, remark: data.remark },
      reference: step.label,
    });
  });

  revalidateDashboard();
  return { success: true };
}
