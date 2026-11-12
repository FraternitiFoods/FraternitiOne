"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canCreateDashboardSite, canEditDashboardSite, canDeleteDashboardSite } from "@/lib/permissions";
import { deleteEvidenceObject } from "@/lib/tracker-storage";
import { getDashboardStepTemplate } from "@/lib/dashboard-template";
import { ensureOpsBoqRows } from "@/lib/ops-boq-ensure";
import {
  DEFAULT_STEP_ASSIGNEE,
  createDashboardSiteSchema,
  isDeleteSiteConfirmed,
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

        // Makes the site appear in Site Tracker (dropdown + All sites) AND Site
        // BOQ (the website is the source of truth; BOQ queries filter on
        // usedInBoq). Tracker steps are lazy per-site rows, so this one row is
        // all it needs; `WEB-` sourceKey as in site-boq/sites/actions.ts.
        const trackerSite = await tx.site.create({
          data: {
            sourceKey: `WEB-${randomUUID()}`,
            name: data.name,
            sortOrder: nextTrackerSortOrder,
            usedInBoq: true,
            usedInTracker: true,
          },
          select: { id: true },
        });

        // Operations BOQ: the 11 fixed rows, in this same transaction (idempotent).
        const opsBoqRows = await ensureOpsBoqRows(tx, trackerSite.id);

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
            opsBoqRows,
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
  for (const p of ["/site-boq", "/site-boq/sites", "/site-boq/site-view", "/site-boq/items", "/operations-boq"]) revalidatePath(p);
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

/**
 * Permanently deletes a website-created Dashboard site. Admin only.
 *
 * Guards (all server-side, none trust the UI): role; the site exists and is
 * WEBSITE-owned (sheet sites are sync-owned and would come back); the caller
 * typed the exact "Delete site <name>" phrase; and the linked shared Site has no
 * Purchase Orders (PO.siteId is Restrict, and a PO is a record we do not destroy).
 *
 * Removes, in ONE transaction: the DashboardSite (+ its steps and franchisee
 * assignment; dept-link rows just lose their site link) AND the shared `Site`
 * that createDashboardSite made with it (matched by name + the `WEB-` sourceKey),
 * which cascades to Site Tracker steps/evidence rows, Site BOQ site items and
 * Operations BOQ rows. Tracker evidence files in storage are deleted after the
 * commit (best effort: a storage failure is logged, never un-deletes the site).
 * The audit event stays (AuditEvent has no FK to the site) and records what was removed.
 */
export async function deleteDashboardSite(siteId: string, confirmText: string): Promise<ActionState> {
  const user = await requireUser();
  if (!canDeleteDashboardSite(user)) return { error: NO_PERMISSION };

  if (typeof siteId !== "string" || !siteId) return { error: "Invalid request." };

  const site = await db.dashboardSite.findUnique({
    where: { id: siteId },
    select: { id: true, name: true, origin: true, driveFolderUrl: true },
  });
  if (!site) return { error: "Site not found. It may already have been deleted." };
  if (site.origin !== "WEBSITE") return { error: "Only website-created sites can be deleted here." };
  if (!isDeleteSiteConfirmed(site.name, confirmText)) return { error: "The confirmation text does not match." };

  const shared = await db.site.findFirst({
    where: { name: site.name, sourceKey: { startsWith: "WEB-" } },
    select: { id: true },
  });

  if (shared) {
    const poCount = await db.purchaseOrder.count({ where: { siteId: shared.id } });
    if (poCount > 0) {
      return {
        error: `This site has ${poCount} purchase order${poCount === 1 ? "" : "s"} and cannot be deleted. Purchase orders are permanent records.`,
      };
    }
  }

  // Collected before the delete: the rows cascade away, and the storage keys are only known from them.
  const evidenceKeys = shared
    ? (await db.trackerEvidence.findMany({ where: { siteStep: { siteId: shared.id } }, select: { storageKey: true } })).map(
        (e) => e.storageKey
      )
    : [];

  try {
    await db.$transaction(
      async (tx) => {
        const dashboardSteps = await tx.dashboardStep.count({ where: { siteId: site.id } });
        const trackerSteps = shared ? await tx.trackerSiteStep.count({ where: { siteId: shared.id } }) : 0;
        const siteBoqItems = shared ? await tx.siteItem.count({ where: { siteId: shared.id } }) : 0;
        const opsBoqRows = shared ? await tx.opsBoqRow.count({ where: { siteId: shared.id } }) : 0;

        // deleteMany: a concurrent delete of the same site is a no-op, not a crash.
        await tx.dashboardSite.deleteMany({ where: { id: site.id } });
        if (shared) await tx.site.deleteMany({ where: { id: shared.id } });

        await writeAuditEvent(tx, {
          actor: user,
          entityType: "DashboardSite",
          entityId: site.id,
          action: "DELETE",
          oldValue: {
            name: site.name,
            driveFolderUrl: site.driveFolderUrl,
            sharedSiteId: shared?.id ?? null,
            removed: { dashboardSteps, trackerSteps, trackerEvidenceFiles: evidenceKeys.length, siteBoqItems, opsBoqRows },
          },
          reference: `Deleted site "${site.name}" (Dashboard)`,
        });
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
  } catch (e) {
    // A purchase order was created for this site between the check above and the delete (FK is Restrict).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return { error: "This site has purchase orders and cannot be deleted." };
    }
    throw e;
  }

  await Promise.all(
    evidenceKeys.map((key) =>
      deleteEvidenceObject(key).catch((err) => {
        console.error("Failed to delete tracker evidence object after site delete (DB rows already removed):", key, err);
      })
    )
  );

  revalidateDashboard();
  revalidatePath("/site-tracker");
  for (const p of ["/site-boq", "/site-boq/sites", "/site-boq/site-view", "/site-boq/items", "/site-boq/purchase-orders", "/operations-boq"]) {
    revalidatePath(p);
  }
  redirect("/dashboard");
}
