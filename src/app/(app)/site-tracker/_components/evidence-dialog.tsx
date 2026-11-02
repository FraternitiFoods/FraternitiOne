"use client";

import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEvidenceUploader } from "./use-evidence-upload";
import type { EvidenceItem, StepRowData } from "./types";

function EvidenceThumb({ item, canDelete, onDelete }: { item: EvidenceItem; canDelete: boolean; onDelete: (id: string) => void }) {
  const [enlarged, setEnlarged] = useState(false);
  const src = `/api/tracker/evidence/${item.id}`;

  return (
    <>
      <div className="group relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10">
        {item.kind === "IMAGE" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={item.fileName}
            className="size-full cursor-pointer object-cover"
            onClick={() => setEnlarged(true)}
          />
        ) : (
          <video src={src} className="size-full object-cover" controls preload="metadata" />
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            aria-label={`Delete ${item.fileName}`}
            className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {enlarged && item.kind === "IMAGE" && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setEnlarged(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={item.fileName} className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </>
  );
}

/**
 * site-tracker-plan.md section 6: the evidence icon's gallery popup, and
 * (when `pendingCompletion` is set) the forced-upload "Completed" dialog —
 * same component, since both need the same grid + uploader, just a
 * different footer action.
 */
export function EvidenceDialog({
  open,
  onOpenChange,
  siteId,
  step,
  canEdit,
  canDelete,
  pendingCompletion,
  onEvidenceChange,
  onConfirmCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  step: StepRowData;
  canEdit: boolean;
  canDelete: boolean;
  pendingCompletion: boolean;
  onEvidenceChange: (stepId: string, evidence: EvidenceItem[]) => void;
  onConfirmCompleted: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { uploads, uploadFiles, clearUploads } = useEvidenceUploader({
    siteId,
    stepId: step.id,
    onUploaded: (evidence) => {
      onEvidenceChange(step.id, [...step.evidence, evidence]);
    },
  });

  const canConfirm = step.legacyCompleted || step.evidence.length > 0;

  function handleOpenChange(next: boolean) {
    if (!next) clearUploads();
    onOpenChange(next);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this evidence? This can't be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/tracker/evidence/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not delete evidence.");
      onEvidenceChange(step.id, step.evidence.filter((e) => e.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete evidence.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleConfirmCompleted() {
    setConfirming(true);
    try {
      const ok = await onConfirmCompleted();
      if (ok) handleOpenChange(false);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step.code} {step.name}
          </DialogTitle>
          <DialogDescription>
            {pendingCompletion
              ? "Add at least one photo or video before marking this step Completed."
              : "Photo/video evidence for this step."}
          </DialogDescription>
        </DialogHeader>

        {step.evidence.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {step.evidence.map((item) => (
              <EvidenceThumb
                key={item.id}
                item={item}
                canDelete={canDelete && deletingId !== item.id}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No evidence uploaded yet.</p>
        )}

        {canEdit && (
          <div className="space-y-2 border-t pt-3">
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) uploadFiles(files);
                e.target.value = "";
              }}
              className="block w-full text-sm text-muted-foreground"
            />
            {uploads.length > 0 && (
              <ul className="space-y-1">
                {uploads.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                    {u.status === "error" ? (
                      <span className="text-destructive">{u.error}</span>
                    ) : u.status === "done" ? (
                      <span className="text-emerald-600">Uploaded</span>
                    ) : u.status === "confirming" ? (
                      <span className="text-muted-foreground">Confirming…</span>
                    ) : (
                      <span className="text-muted-foreground">{u.progress}%</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {pendingCompletion ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmCompleted} disabled={!canConfirm || confirming}>
                {confirming ? "Marking Completed…" : "Mark Completed"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
