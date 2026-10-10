"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import {
  canActOnComplaint,
  canCreateComplaint,
  canManageComplaintCategory,
  canViewProject,
} from "@/lib/permissions";
import { buildComplaintAttachmentKey, uploadDocument } from "@/lib/storage";
import { getMalwareScanner } from "@/lib/malware-scan";
import { ComplaintCategory, ComplaintStatus, TaskPriority } from "@prisma/client";

export type ActionState = { error?: string } | undefined;

async function loadProjectOrThrow(projectId: string) {
  const project = await db.franchiseProject.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found.");
  return project;
}

// Same judgment call as document-actions.ts (no SRD-specified cap) — kept
// under next.config.ts's serverActions.bodySizeLimit, narrower type list
// since a complaint attachment is a photo/receipt, not an office document.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

const CreateComplaintSchema = z.object({
  category: z.nativeEnum(ComplaintCategory),
  subject: z.string().trim().min(1, "Subject is required."),
  description: z.string().trim().min(1, "Description is required."),
  priority: z.nativeEnum(TaskPriority),
});

export async function createComplaint(
  projectId: string,
  redirectTo: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);

  if (!canCreateComplaint(user, project)) {
    return { error: "Project not found." };
  }

  const parsed = CreateComplaintSchema.safeParse({
    category: formData.get("category"),
    subject: formData.get("subject"),
    description: formData.get("description"),
    priority: formData.get("priority"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  // Optional — an empty file input still submits a 0-byte File, not null.
  let attachment: { key: string; fileName: string; mimeType: string; size: number } | null = null;
  let attachmentBuffer: Buffer | null = null;
  const fileValue = formData.get("attachment");
  if (fileValue instanceof File && fileValue.size > 0) {
    if (fileValue.size > MAX_ATTACHMENT_BYTES) {
      return { error: `Attachment is too large — max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB.` };
    }
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(fileValue.type)) {
      return { error: "Unsupported attachment type. Use PDF, JPG, PNG, or WEBP." };
    }
    const key = buildComplaintAttachmentKey({ projectId, fileName: fileValue.name });
    attachmentBuffer = Buffer.from(await fileValue.arrayBuffer());
    await uploadDocument({ key, body: attachmentBuffer, contentType: fileValue.type });
    attachment = { key, fileName: fileValue.name, mimeType: fileValue.type, size: fileValue.size };
  }

  await db.$transaction(async (tx) => {
    const complaint = await tx.complaint.create({
      data: {
        projectId,
        raisedById: user.id,
        category: data.category,
        subject: data.subject,
        description: data.description,
        priority: data.priority,
        attachmentFileKey: attachment?.key ?? null,
        attachmentFileName: attachment?.fileName ?? null,
        attachmentMimeType: attachment?.mimeType ?? null,
        attachmentFileSize: attachment?.size ?? null,
        // Nullable field — only an attachment that actually exists needs a
        // scan; schema default doesn't apply here since this column has no
        // @default (there's nothing sensible to default an absent
        // attachment's scan status to). Real scan runs in after(), same
        // reasoning as the onboarding/Document Vault paths.
        attachmentScanStatus: attachment ? "PENDING" : null,
      },
    });

    if (attachment && attachmentBuffer) {
      const buffer = attachmentBuffer;
      const mimeType = attachment.mimeType;
      after(async () => {
        const scan = await getMalwareScanner().scan(buffer, mimeType);
        await db.complaint.update({
          where: { id: complaint.id },
          data: { attachmentScanStatus: scan.status, attachmentScanError: scan.error },
        });
      });
    }

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Complaint",
      entityId: complaint.id,
      action: "CREATE",
      newValue: {
        category: complaint.category,
        subject: complaint.subject,
        priority: complaint.priority,
        status: complaint.status,
      },
    });
  });

  redirect(redirectTo);
}

const UpdateComplaintStatusSchema = z.object({
  status: z.nativeEnum(ComplaintStatus),
});

export async function updateComplaintStatus(
  complaintId: string,
  projectId: string,
  redirectTo: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);
  const complaint = await db.complaint.findUnique({ where: { id: complaintId } });

  if (!complaint || complaint.projectId !== projectId || !canViewProject(user, project)) {
    return { error: "Complaint not found." };
  }
  if (!canActOnComplaint(user, complaint, project)) {
    return { error: "You don't have permission to update this complaint." };
  }

  const parsed = UpdateComplaintStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { status } = parsed.data;
  const isClosing = status === "RESOLVED" || status === "CLOSED";

  await db.$transaction(async (tx) => {
    const updated = await tx.complaint.update({
      where: { id: complaintId },
      data: {
        status,
        // Reopening clears the old resolution date — a fresh RESOLVED/CLOSED
        // later sets a new one rather than keeping a stale timestamp.
        resolutionDate: isClosing ? new Date() : status === "REOPENED" ? null : complaint.resolutionDate,
      },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Complaint",
      entityId: complaint.id,
      action: "UPDATE",
      oldValue: { status: complaint.status },
      newValue: { status: updated.status },
    });
  });

  redirect(redirectTo);
}

const AssignComplaintSchema = z.object({
  assignedToId: z.string().min(1, "Select someone to assign."),
});

export async function assignComplaint(
  complaintId: string,
  projectId: string,
  redirectTo: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);
  const complaint = await db.complaint.findUnique({ where: { id: complaintId } });

  if (!complaint || complaint.projectId !== projectId || !canViewProject(user, project)) {
    return { error: "Complaint not found." };
  }
  // Deliberately narrower than canActOnComplaint: assigning staff is a
  // department-owner action, not something the franchisee who raised it (or
  // the current assignee alone) should be able to hand off to someone else.
  if (!canManageComplaintCategory(user, complaint.category)) {
    return { error: "You don't have permission to assign this complaint." };
  }

  const parsed = AssignComplaintSchema.safeParse({ assignedToId: formData.get("assignedToId") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.complaint.update({
      where: { id: complaintId },
      data: {
        assignedToId: parsed.data.assignedToId,
        status: complaint.status === "OPEN" ? "ASSIGNED" : complaint.status,
      },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Complaint",
      entityId: complaint.id,
      action: "UPDATE",
      oldValue: { assignedToId: complaint.assignedToId, status: complaint.status },
      newValue: { assignedToId: updated.assignedToId, status: updated.status },
    });
  });

  redirect(redirectTo);
}

const AddCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment can't be empty."),
});

export async function addComplaintComment(
  complaintId: string,
  projectId: string,
  redirectTo: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);
  const complaint = await db.complaint.findUnique({ where: { id: complaintId } });

  if (!complaint || complaint.projectId !== projectId || !canViewProject(user, project)) {
    return { error: "Complaint not found." };
  }

  const parsed = AddCommentSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Same discipline as addTaskComment: a lightweight sub-record, not audited
  // individually — the complaint's own status/assignment changes are.
  await db.complaintComment.create({
    data: { complaintId, authorId: user.id, body: parsed.data.body },
  });

  redirect(redirectTo);
}
