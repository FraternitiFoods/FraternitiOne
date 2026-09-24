"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { getSupervisorUploadUrl, buildDocumentKey } from "@/lib/storage";
import { getTaskRoute, categoryHasBoqTasks } from "@/lib/ops-route";
import type { CurrentUser } from "@/lib/session";

// plan.md section 16, "Work not on the list" (confirmed 2026-09-24): every
// BOQ category gets one reusable "Other" task for work that isn't on the
// checklist. Because decision 6 (upload -> Task COMPLETED) still applies to
// it like any other task, finalizeUpload below auto-creates a fresh
// replacement the moment one is used, so there's always exactly one
// available — the alternative (never marking it complete) would special-case
// the status rule everywhere else in the app assumes holds.
const OTHER_TASK_TITLE = "Other (not on checklist)";

// 50MB, confirmed 2026-09-24 — comfortably covers a phone photo or a
// ~30-60s video clip. Checked server-side before a presigned URL is even
// issued; the client also checks this for immediate feedback, but that's a
// courtesy, not the real gate.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

async function requireSupervisorMembership(projectId: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "SITE_SUPERVISOR") {
    throw new Error("Not authorized.");
  }
  const membership = await db.projectMember.findUnique({
    where: { userId_projectId: { userId: user.id, projectId } },
  });
  if (!membership) {
    throw new Error("Not authorized.");
  }
  return user;
}

export type BoqTask = { id: string; title: string; status: string };

/**
 * Task picker for one category (plan.md section 16, decision 4). Lazily
 * ensures the category's "Other" task exists — self-healing for both new
 * and pre-existing projects, no separate backfill script needed the way
 * section 15's template changes did.
 */
export async function getTasksForCategory(projectId: string, category: string): Promise<BoqTask[]> {
  const user = await requireSupervisorMembership(projectId);

  if (!categoryHasBoqTasks(category)) {
    throw new Error("Not authorized.");
  }

  const existingOther = await db.task.findFirst({
    where: { projectId, category, title: OTHER_TASK_TITLE },
  });

  if (!existingOther) {
    const sample = await db.task.findFirst({
      where: { projectId, category },
      select: { module: true, lifecycleStage: true, order: true },
    });
    const project = await db.franchiseProject.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (sample && project) {
      const created = await db.task.create({
        data: {
          projectId,
          module: sample.module,
          category,
          lifecycleStage: sample.lifecycleStage,
          order: sample.order + 1,
          title: OTHER_TASK_TITLE,
          ownerId: project.ownerId,
          createdById: user.id,
        },
      });
      await writeAuditEvent(db, {
        actor: user,
        projectId,
        entityType: "Task",
        entityId: created.id,
        action: "CREATE",
        newValue: { title: created.title, category: created.category },
        reference: "Auto-created 'Other' task for the /m task picker",
        source: "mobile",
      });
    }
  }

  const tasks = await db.task.findMany({
    where: { projectId, category },
    select: { id: true, title: true, status: true },
    orderBy: { order: "asc" },
  });

  return tasks.filter((t) => getTaskRoute(category, t.title) === "BOQ");
}

export type PresignResult = { error: string } | { uploadUrl: string; key: string };

/** Step 1 of the upload: validate everything server-side, then hand back a presigned B2 PUT URL. */
export async function getPresignedUpload(input: {
  projectId: string;
  taskId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}): Promise<PresignResult> {
  await requireSupervisorMembership(input.projectId);

  if (input.fileSize > MAX_UPLOAD_BYTES) {
    return { error: "File is too large (max 50MB)." };
  }
  if (!/^image\/|^video\//.test(input.contentType)) {
    return { error: "Only photos and videos can be uploaded." };
  }

  const task = await db.task.findUnique({ where: { id: input.taskId } });
  if (!task || task.projectId !== input.projectId) {
    return { error: "Task not found." };
  }
  if (!task.category || getTaskRoute(task.category, task.title) !== "BOQ") {
    return { error: "This task isn't available for upload." };
  }

  const key = buildDocumentKey({
    projectId: input.projectId,
    category: task.category,
    fileName: input.fileName,
  });
  const uploadUrl = await getSupervisorUploadUrl({ key, contentType: input.contentType });

  return { uploadUrl, key };
}

export type FinalizeResult = { error: string } | { success: true };

/**
 * Step 2, called once the browser has already PUT the file straight to B2.
 * Records the Document, marks the Task COMPLETED, and writes both AuditEvents
 * in one transaction (plan.md section 4/16's audit rule) — plus, for an
 * "Other" task, spawns its replacement in the same transaction so it's never
 * even momentarily missing from the picker.
 */
export async function finalizeUpload(input: {
  projectId: string;
  taskId: string;
  key: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}): Promise<FinalizeResult> {
  const user = await requireSupervisorMembership(input.projectId);

  const task = await db.task.findUnique({ where: { id: input.taskId } });
  if (!task || task.projectId !== input.projectId) {
    return { error: "Task not found." };
  }
  const project = await db.franchiseProject.findUnique({
    where: { id: input.projectId },
    select: { ownerId: true },
  });
  if (!project) {
    return { error: "Project not found." };
  }

  const isOtherTask = task.title === OTHER_TASK_TITLE;

  await db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        projectId: input.projectId,
        taskId: task.id,
        category: task.module,
        title: `${task.title} — ${new Date().toLocaleDateString("en-IN")}`,
        fileKey: input.key,
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.contentType,
        ownerId: user.id,
      },
    });
    await writeAuditEvent(tx, {
      actor: user,
      projectId: input.projectId,
      entityType: "Document",
      entityId: document.id,
      action: "CREATE",
      newValue: { fileName: document.fileName, taskId: task.id },
      reference: "Uploaded via /m (site supervisor)",
      source: "mobile",
    });

    await tx.task.update({
      where: { id: task.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await writeAuditEvent(tx, {
      actor: user,
      projectId: input.projectId,
      entityType: "Task",
      entityId: task.id,
      action: "UPDATE",
      oldValue: { status: task.status },
      newValue: { status: "COMPLETED" },
      reference: "Marked complete via /m upload",
      source: "mobile",
    });

    if (isOtherTask) {
      const replacement = await tx.task.create({
        data: {
          projectId: input.projectId,
          module: task.module,
          category: task.category,
          lifecycleStage: task.lifecycleStage,
          order: task.order,
          title: OTHER_TASK_TITLE,
          ownerId: project.ownerId,
          createdById: user.id,
        },
      });
      await writeAuditEvent(tx, {
        actor: user,
        projectId: input.projectId,
        entityType: "Task",
        entityId: replacement.id,
        action: "CREATE",
        newValue: { title: replacement.title, category: replacement.category },
        reference: "Auto-recreated 'Other' task after a supervisor upload used the previous one",
        source: "mobile",
      });
    }
  });

  revalidatePath(`/m/${input.projectId}`);
  return { success: true };
}
