/**
 * Evidence upload limits (site-tracker-plan.md section 5). Pure — no DB/B2
 * access — so the presign and confirm routes validate against the exact
 * same rule and it's unit-testable without a server.
 */
export const ALLOWED_EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export type EvidenceKind = "IMAGE" | "VIDEO";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function kindForMime(mimeType: string): EvidenceKind | null {
  if (!(ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(mimeType)) return null;
  return mimeType.startsWith("video/") ? "VIDEO" : "IMAGE";
}

export type EvidenceValidation = { ok: true; kind: EvidenceKind } | { ok: false; error: string };

export function validateEvidenceUpload(params: { mimeType: string; sizeBytes: number }): EvidenceValidation {
  const kind = kindForMime(params.mimeType);
  if (!kind) {
    return {
      ok: false,
      error: `Unsupported file type "${params.mimeType}". Allowed: JPEG/PNG/WEBP photos or MP4/MOV/WEBM videos.`,
    };
  }
  const max = kind === "IMAGE" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (params.sizeBytes <= 0 || params.sizeBytes > max) {
    const maxLabel = kind === "IMAGE" ? "15 MB" : "100 MB";
    return { ok: false, error: `File is too large — max ${maxLabel} for ${kind === "IMAGE" ? "photos" : "videos"}.` };
  }
  return { ok: true, kind };
}

const EVIDENCE_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** site-tracker-plan.md section 5: `site-tracker/<siteId>/<stepId>/<uuid>.<ext>` — ext from the (already-validated) mimeType, never the client's filename. */
export function evidenceExtensionForMime(mimeType: string): string {
  return EVIDENCE_MIME_EXTENSIONS[mimeType] ?? "bin";
}
