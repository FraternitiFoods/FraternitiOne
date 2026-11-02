import "server-only";

import { mkdir, writeFile, stat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  isB2Configured,
  buildTrackerEvidenceKey,
  getTrackerEvidenceUploadUrl,
  getTrackerEvidenceViewUrl,
  headTrackerEvidenceObject,
  deleteTrackerEvidenceObject,
} from "@/lib/storage";

/**
 * Site Tracker storage policy (site-tracker-plan.md section 5): real B2 when
 * configured; otherwise, outside production, fall back to local disk under
 * `.local-uploads/` (gitignored) through a dev-only route so the whole
 * upload/confirm/view flow can be exercised without B2 credentials. In
 * production, missing credentials must fail loudly (storage.ts's
 * requireB2Config already throws) — never silently fall back there.
 */
function shouldUseLocalDevFallback(): boolean {
  return !isB2Configured() && process.env.NODE_ENV !== "production";
}

export function isUsingLocalDevFallback(): boolean {
  return shouldUseLocalDevFallback();
}

const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), ".local-uploads");

/** Evidence keys are always server-generated (buildTrackerEvidenceKey) in this exact shape — reject anything else before touching the filesystem. */
const SAFE_KEY_PATTERN = /^site-tracker\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;

function localFilePath(key: string): string {
  if (!SAFE_KEY_PATTERN.test(key)) {
    throw new Error(`Refusing to touch local dev storage for an unexpected key shape: "${key}".`);
  }
  return path.join(LOCAL_UPLOAD_ROOT, key);
}

export { buildTrackerEvidenceKey };

export async function getEvidenceUploadUrl(params: {
  key: string;
  contentType: string;
}): Promise<{ uploadUrl: string; devLocal: boolean }> {
  if (shouldUseLocalDevFallback()) {
    return { uploadUrl: `/api/tracker/evidence/dev-upload?key=${encodeURIComponent(params.key)}`, devLocal: true };
  }
  const uploadUrl = await getTrackerEvidenceUploadUrl(params);
  return { uploadUrl, devLocal: false };
}

/** section 5 "confirm" step: verify the object exists and its size matches, in either storage backend. */
export async function verifyEvidenceObject(params: { key: string; expectedSize: number }): Promise<boolean> {
  if (shouldUseLocalDevFallback()) {
    try {
      const stats = await stat(localFilePath(params.key));
      return stats.size === params.expectedSize;
    } catch {
      return false;
    }
  }
  const head = await headTrackerEvidenceObject({ key: params.key });
  return head !== null && head.sizeBytes === params.expectedSize;
}

/** section 5 "view": a signed B2 GET URL, or the raw bytes for the local dev fallback (see the [id] view route). */
export async function getEvidenceViewUrl(params: { key: string }): Promise<string> {
  return getTrackerEvidenceViewUrl(params);
}

export async function readLocalDevFile(key: string): Promise<Buffer> {
  return readFile(localFilePath(key));
}

export async function writeLocalDevFile(key: string, body: Buffer): Promise<void> {
  const filePath = localFilePath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
}

export async function deleteLocalDevFile(key: string): Promise<void> {
  await rm(localFilePath(key), { force: true });
}

/** Deletes the underlying object in whichever backend is active — called when an evidence row is deleted. */
export async function deleteEvidenceObject(key: string): Promise<void> {
  if (shouldUseLocalDevFallback()) {
    await deleteLocalDevFile(key);
    return;
  }
  await deleteTrackerEvidenceObject({ key });
}
