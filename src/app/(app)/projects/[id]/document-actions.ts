"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canActOnDocument, canManageDocumentCategory, canViewProject } from "@/lib/permissions";
import { buildDocumentKey, uploadDocument } from "@/lib/storage";
import { Department, DocumentStatus } from "@prisma/client";

export type ActionState = { error?: string } | undefined;

// Judgment calls, not SRD requirements — the SRD doesn't specify a size cap
// or type allowlist for the Document Vault. Kept just under next.config.ts's
// serverActions.bodySizeLimit (20mb) so a file this size doesn't get
// rejected by Next.js itself before this validation ever runs.
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

async function loadProjectOrThrow(projectId: string) {
  const project = await db.franchiseProject.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found.");
  return project;
}

function validateFile(value: FormDataEntryValue | null): { error: string } | { file: File } {
  if (!(value instanceof File) || value.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (value.size > MAX_FILE_SIZE_BYTES) {
    return { error: `File is too large — max ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.` };
  }
  if (!ALLOWED_MIME_TYPES.has(value.type)) {
    return { error: "Unsupported file type. Use PDF, Word, Excel, PowerPoint, or an image." };
  }
  return { file: value };
}

const CreateDocumentSchema = z.object({
  category: z.nativeEnum(Department),
  title: z.string().trim().min(1, "Title is required."),
});

export async function createDocument(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);

  if (!canViewProject(user, project)) {
    return { error: "Project not found." };
  }

  const parsed = CreateDocumentSchema.safeParse({
    category: formData.get("category"),
    title: formData.get("title"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { category, title } = parsed.data;

  if (!canManageDocumentCategory(user, category)) {
    return { error: "You don't have permission to upload documents in that category." };
  }

  const fileResult = validateFile(formData.get("file"));
  if ("error" in fileResult) {
    return { error: fileResult.error };
  }
  const { file } = fileResult;

  const key = buildDocumentKey({ projectId, category, fileName: file.name });
  await uploadDocument({
    key,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
  });

  await db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        projectId,
        category,
        title,
        fileKey: key,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        ownerId: user.id,
      },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Document",
      entityId: document.id,
      action: "CREATE",
      newValue: {
        category: document.category,
        title: document.title,
        version: document.version,
        fileName: document.fileName,
        status: document.status,
      },
    });
  });

  redirect(`/projects/${projectId}`);
}

const CreateDocumentVersionSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
});

export async function createDocumentVersion(
  documentId: string,
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);
  const previous = await db.document.findUnique({ where: { id: documentId } });

  if (!previous || previous.projectId !== projectId || !canViewProject(user, project)) {
    return { error: "Document not found." };
  }
  if (!canActOnDocument(user, previous, project)) {
    return { error: "You don't have permission to update this document." };
  }

  const parsed = CreateDocumentVersionSchema.safeParse({ title: formData.get("title") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const fileResult = validateFile(formData.get("file"));
  if ("error" in fileResult) {
    return { error: fileResult.error };
  }
  const { file } = fileResult;

  // New version inherits the category — the version chain is meant to track
  // one document's history, not let a replacement jump departments.
  const key = buildDocumentKey({ projectId, category: previous.category, fileName: file.name });
  await uploadDocument({
    key,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
  });

  await db.$transaction(async (tx) => {
    const next = await tx.document.create({
      data: {
        projectId,
        category: previous.category,
        title: parsed.data.title,
        version: previous.version + 1,
        supersedesId: previous.id,
        fileKey: key,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        ownerId: user.id,
      },
    });

    await tx.document.update({
      where: { id: previous.id },
      data: { status: DocumentStatus.SUPERSEDED },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Document",
      entityId: next.id,
      action: "CREATE",
      reference: `Supersedes ${previous.id}`,
      newValue: {
        category: next.category,
        title: next.title,
        version: next.version,
        fileName: next.fileName,
        status: next.status,
      },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Document",
      entityId: previous.id,
      action: "UPDATE",
      reference: `Superseded by ${next.id}`,
      oldValue: { status: previous.status },
      newValue: { status: DocumentStatus.SUPERSEDED },
    });
  });

  redirect(`/projects/${projectId}`);
}

const UpdateDocumentStatusSchema = z.object({
  status: z.nativeEnum(DocumentStatus),
});

export async function updateDocumentStatus(
  documentId: string,
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);
  const document = await db.document.findUnique({ where: { id: documentId } });

  if (!document || document.projectId !== projectId || !canViewProject(user, project)) {
    return { error: "Document not found." };
  }
  if (!canActOnDocument(user, document, project)) {
    return { error: "You don't have permission to update this document." };
  }

  const parsed = UpdateDocumentStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.document.update({
      where: { id: documentId },
      data: { status: parsed.data.status },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Document",
      entityId: document.id,
      action: "UPDATE",
      oldValue: { status: document.status },
      newValue: { status: updated.status },
    });
  });

  redirect(`/projects/${projectId}`);
}
