"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import {
  canAssignDashboardTasks,
  canCreateDashboardSite,
  canEditDashboardSite,
  canDeleteDashboardSite,
} from "@/lib/permissions";
import { canEditStep } from "@/lib/dashboard-access";
import { countByStage, diffAssignments, setUserSiteAssignmentsSchema } from "@/lib/dashboard-assignment-input";
import { deleteEvidenceObject } from "@/lib/tracker-storage";
import { createWebsiteSiteInTx, findSiteSlots } from "@/lib/dashboard-site-create";
import {
  createDashboardSiteSchema,
  isDeleteSiteConfirmed,
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
  revalidatePath("/dashboard/[site]/team", "page");
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

  const slots = await findSiteSlots(data.name);
  if (slots.dashboardNameTaken) return { error: "A site with this name already exists." };
  if (slots.trackerNameTaken) return { error: "A tracker/BOQ site with this name already exists." };

  try {
    await db.$transaction(
      async (tx) => {
        const created = await createWebsiteSiteInTx(tx, {
          name: data.name,
          driveFolderUrl: data.driveFolderUrl,
          deptLinksText: data.deptLinksText,
          sortOrder: slots.nextSortOrder,
          trackerSortOrder: slots.nextTrackerSortOrder,
        });

        await writeAuditEvent(tx, {
          actor: user,
          entityType: "DashboardSite",
          entityId: created.dashboardSiteId,
          action: "CREATE",
          newValue: {
            name: data.name,
            driveFolderUrl: data.driveFolderUrl,
            deptLinksText: data.deptLinksText,
            steps: created.steps,
            trackerSiteId: created.trackerSiteId,
            opsBoqRows: created.opsBoqRows,
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
 * Admin, or the person Admin assigned to this exact step (plan.md section 12,
 * dashboard-access.ts canEditStep); step exists, leaf only (parents derive
 * from children), site is WEBSITE-owned (sheet sites are overwritten by the
 * next sync). A forged call for someone else's step is refused here no matter
 * what the UI showed.
 */
export async function updateDashboardStep(stepId: string, status: string, remark: string | null): Promise<ActionState> {
  const user = await requireUser();
  if (typeof stepId !== "string" || !stepId) return { error: "Invalid request." };

  // Permission first, before revealing anything about the step: a non-admin must hold an assignment row for it.
  const isAssignedToStep =
    user.role === "ADMIN" || user.role === "FRANCHISEE"
      ? false
      : (await db.dashboardStepAssignment.count({ where: { stepId, userId: user.id } })) > 0;
  if (user.role !== "ADMIN" && !isAssignedToStep) return { error: NO_PERMISSION };

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
  // Single authority for the final decision (also rules out FRANCHISEE and any role/assignment mismatch).
  if (!canEditStep({ role: user.role, origin: step.site.origin, isParent: step.isParent, isAssignedToStep })) {
    return { error: NO_PERMISSION };
  }

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
 * Makes `userId`'s assigned tasks on one website-created site exactly `stepIds`
 * (replace semantics: ticked = assigned, unticked = removed; an empty list
 * removes them from the site). Admin only (plan.md section 12). Called from
 * the Team page's client component, so everything is validated here: the site
 * is WEBSITE-owned (sheet sites regenerate step ids on every sync), the person
 * is an assignable internal user (not Admin — already everything — and not a
 * franchisee), and every step id is a leaf of THIS site. One transaction, ONE
 * audit event with per-stage counts (not hundreds of ids).
 */
export async function setUserSiteAssignments(siteId: string, userId: string, stepIds: string[]): Promise<ActionState> {
  const admin = await requireUser();
  if (!canAssignDashboardTasks(admin)) return { error: NO_PERMISSION };

  const parsed = setUserSiteAssignmentsSchema.safeParse({ siteId, userId, stepIds });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const data = parsed.data;

  const [site, person] = await Promise.all([
    db.dashboardSite.findUnique({ where: { id: data.siteId }, select: { id: true, name: true, origin: true } }),
    db.user.findUnique({ where: { id: data.userId }, select: { id: true, name: true, email: true, role: true, isActive: true } }),
  ]);
  if (!site) return { error: "Site not found." };
  if (site.origin !== "WEBSITE") return { error: "Tasks can only be assigned on website-created sites." };
  if (!person) return { error: "User not found." };
  // Adding is restricted to active internal non-admins; removing is always allowed so leftovers from a role change/deactivation can be cleaned up.
  if (data.stepIds.length > 0) {
    if (person.role === "ADMIN") return { error: "Admins already have access to every task." };
    if (person.role === "FRANCHISEE") return { error: "Franchisee users can't be assigned tasks." };
    if (!person.isActive) return { error: "This user is deactivated." };
  }

  const steps = await db.dashboardStep.findMany({
    where: { siteId: site.id, id: { in: data.stepIds } },
    select: { id: true, stageNo: true, isParent: true },
  });
  if (steps.length !== data.stepIds.length) return { error: "One or more tasks don't belong to this site." };
  if (steps.some((s) => s.isParent)) return { error: "Only individual tasks can be assigned." };

  await db.$transaction(async (tx) => {
    const current = await tx.dashboardStepAssignment.findMany({
      where: { userId: person.id, step: { siteId: site.id } },
      select: { stepId: true, step: { select: { stageNo: true } } },
    });
    const { toAdd, toRemove } = diffAssignments(
      current.map((c) => c.stepId),
      data.stepIds
    );
    if (toAdd.length === 0 && toRemove.length === 0) return;

    if (toRemove.length > 0) {
      await tx.dashboardStepAssignment.deleteMany({ where: { userId: person.id, stepId: { in: toRemove } } });
    }
    if (toAdd.length > 0) {
      await tx.dashboardStepAssignment.createMany({
        data: toAdd.map((stepId) => ({ stepId, userId: person.id, assignedById: admin.id })),
        skipDuplicates: true,
      });
    }

    await writeAuditEvent(tx, {
      actor: admin,
      entityType: "DashboardSite",
      entityId: site.id,
      action: "UPDATE",
      oldValue: { assignee: person.email, tasksPerStage: countByStage(current.map((c) => c.step)) },
      newValue: { assignee: person.email, tasksPerStage: countByStage(steps) },
      reference: `Task assignment: ${person.name} on ${site.name}`,
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
