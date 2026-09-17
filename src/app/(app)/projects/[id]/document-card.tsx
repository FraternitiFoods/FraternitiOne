"use client";

import { useActionState } from "react";
import { createDocumentVersion, updateDocumentStatus, type ActionState } from "./document-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEPARTMENT_LABELS, DOCUMENT_STATUS_LABELS, formatDate, formatFileSize } from "@/lib/format";
import { DOCUMENT_STATUS_BADGE_CLASS } from "@/lib/badge-colors";
import type { Department, DocumentStatus } from "@prisma/client";

const STATUS_OPTIONS: DocumentStatus[] = [
  "DRAFT",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
];

export type DocumentCardData = {
  id: string;
  category: Department;
  title: string;
  version: number;
  status: DocumentStatus;
  fileName: string;
  fileSize: number;
  createdAt: string; // ISO
  owner: { name: string };
};

export function DocumentCard({
  document,
  projectId,
  canAct,
}: {
  document: DocumentCardData;
  projectId: string;
  canAct: boolean;
}) {
  const statusAction = useActionState<ActionState, FormData>(
    updateDocumentStatus.bind(null, document.id, projectId),
    undefined
  );
  const versionAction = useActionState<ActionState, FormData>(
    createDocumentVersion.bind(null, document.id, projectId),
    undefined
  );

  const [statusState, statusFormAction, statusPending] = statusAction;
  const [versionState, versionFormAction, versionPending] = versionAction;

  return (
    <div className="rounded-lg bg-card p-4 space-y-3 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{document.title}</span>
            <Badge variant="outline">{DEPARTMENT_LABELS[document.category]}</Badge>
            <Badge variant="outline">v{document.version}</Badge>
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{document.fileName}</span>
            <span>{formatFileSize(document.fileSize)}</span>
            <span>Uploaded by {document.owner.name}</span>
            <span>{formatDate(document.createdAt)}</span>
          </dl>
        </div>
        <Badge variant="outline" className={DOCUMENT_STATUS_BADGE_CLASS[document.status]}>
          {DOCUMENT_STATUS_LABELS[document.status]}
        </Badge>
      </div>

      <div className="flex items-center gap-2 border-t pt-3">
        <a
          href={`/projects/${projectId}/documents/${document.id}/download`}
          className="text-sm underline underline-offset-4"
        >
          Download
        </a>
      </div>

      {canAct && (
        <>
          <form action={statusFormAction} className="flex flex-wrap items-end gap-2 border-t pt-3">
            <Select name="status" defaultValue={document.status}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue>
                  {(value: DocumentStatus | null) => (value ? DOCUMENT_STATUS_LABELS[value] : "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {DOCUMENT_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" variant="secondary" disabled={statusPending}>
              {statusPending ? "Saving…" : "Update status"}
            </Button>
            {statusState?.error && (
              <p className="w-full text-xs text-destructive">{statusState.error}</p>
            )}
          </form>

          <details className="border-t pt-3">
            <summary className="cursor-pointer text-sm font-medium">Upload new version</summary>
            <form action={versionFormAction} className="mt-3 flex flex-wrap items-end gap-2">
              <Input
                name="title"
                defaultValue={document.title}
                className="h-8 flex-1 min-w-[160px]"
                required
              />
              <Input name="file" type="file" required className="h-8 flex-1 min-w-[180px]" />
              <Button type="submit" size="sm" variant="outline" disabled={versionPending}>
                {versionPending ? "Uploading…" : "Upload"}
              </Button>
              {versionState?.error && (
                <p className="w-full text-xs text-destructive">{versionState.error}</p>
              )}
            </form>
          </details>
        </>
      )}
    </div>
  );
}
