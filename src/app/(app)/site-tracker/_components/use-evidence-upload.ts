"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { validateEvidenceUpload } from "@/lib/tracker-evidence-rules";
import type { EvidenceItem } from "./types";

export type UploadingFile = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "confirming" | "done" | "error";
  error?: string;
};

function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (status ${xhr.status}).`));
    };
    xhr.onerror = () => {
      reject(new Error("Upload failed — a network or CORS error blocked the request to storage."));
    };
    xhr.send(file);
  });
}

/**
 * site-tracker-plan.md section 5 client side: presign -> PUT with progress
 * -> confirm. Validates MIME/size client-side first (same pure rule the
 * server re-checks) so an obviously bad file never starts a network round
 * trip.
 */
export function useEvidenceUploader(params: {
  siteId: string;
  stepId: string;
  onUploaded: (evidence: EvidenceItem, evidenceCount: number) => void;
}) {
  const [uploads, setUploads] = useState<UploadingFile[]>([]);

  const uploadFile = useCallback(
    async (file: File) => {
      const localId = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploads((prev) => [...prev, { id: localId, name: file.name, progress: 0, status: "uploading" }]);

      const patch = (fields: Partial<UploadingFile>) =>
        setUploads((prev) => prev.map((u) => (u.id === localId ? { ...u, ...fields } : u)));

      try {
        const validation = validateEvidenceUpload({ mimeType: file.type, sizeBytes: file.size });
        if (!validation.ok) throw new Error(validation.error);

        const presignRes = await fetch("/api/tracker/evidence/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId: params.siteId,
            stepId: params.stepId,
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
          }),
        });
        const presignBody = await presignRes.json();
        if (!presignRes.ok) throw new Error(presignBody.error ?? "Could not start the upload.");
        const { uploadUrl, storageKey } = presignBody as { uploadUrl: string; storageKey: string };

        await putWithProgress(uploadUrl, file, (progress) => patch({ progress }));
        patch({ status: "confirming", progress: 100 });

        const confirmRes = await fetch("/api/tracker/evidence/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId: params.siteId,
            stepId: params.stepId,
            storageKey,
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
          }),
        });
        const confirmBody = await confirmRes.json();
        if (!confirmRes.ok) throw new Error(confirmBody.error ?? "Could not confirm the upload.");

        patch({ status: "done" });
        params.onUploaded(confirmBody.evidence as EvidenceItem, confirmBody.evidenceCount as number);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed.";
        patch({ status: "error", error: message });
        toast.error(message);
      }
    },
    [params]
  );

  const uploadFiles = useCallback(
    (files: File[]) => {
      for (const file of files) void uploadFile(file);
    },
    [uploadFile]
  );

  const clearUploads = useCallback(() => setUploads([]), []);

  return { uploads, uploadFiles, clearUploads };
}
