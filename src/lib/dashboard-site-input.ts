import { z } from "zod";

/**
 * Pure input rules for website-created Dashboard sites (no DB, no
 * "server-only" so the client dialogs and vitest can import it).
 */

export const SITE_NAME_MAX = 80;
export const DEPT_LINKS_TEXT_MAX = 4000;
export const STEP_REMARK_MAX = 1000;
/** Every step of a website-created site starts assigned to this (free-text column, not a User FK) until real assignment exists. */
export const DEFAULT_STEP_ASSIGNEE = "Admin";

/** Trim + collapse internal whitespace — what gets stored as the site name (and used as the URL key). */
export function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Same rule as normalizeName in src/lib/dashboard-sync/commit.ts (trim,
 * collapse whitespace, lowercase) — the sync matches sheet sites to rows by
 * this, so the duplicate check here must use the identical rule or a
 * website site could collide with a later sheet site unnoticed.
 */
export function normalizeSiteName(name: string): string {
  return collapseSpaces(name).toLowerCase();
}

/** http(s) only — these values end up in an href, so javascript:/data: must never pass. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** FormData.get() gives string | File | null; blank optional fields are stored as null. */
function emptyToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const nameSchema = z
  .string({ error: "Name is required." })
  .transform(collapseSpaces)
  .pipe(
    z
      .string()
      .min(1, "Name is required.")
      .max(SITE_NAME_MAX, `Name must be at most ${SITE_NAME_MAX} characters.`)
      .refine((v) => !CONTROL_CHARS.test(v), "Name contains invalid characters.")
  );

const driveUrlSchema = z
  .unknown()
  .transform(emptyToNull)
  .pipe(z.string().refine(isHttpUrl, "Drive folder link must be a valid http(s) URL.").nullable());

const deptLinksTextSchema = z
  .unknown()
  .transform(emptyToNull)
  .pipe(z.string().max(DEPT_LINKS_TEXT_MAX, `Department links must be at most ${DEPT_LINKS_TEXT_MAX} characters.`).nullable());

export const createDashboardSiteSchema = z.object({
  name: nameSchema,
  driveFolderUrl: driveUrlSchema,
  deptLinksText: deptLinksTextSchema,
});

export const updateDashboardSiteDetailsSchema = z.object({
  driveFolderUrl: driveUrlSchema,
  deptLinksText: deptLinksTextSchema,
});

export const STEP_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "NOT_REQUIRED"] as const;
export type StepStatusValue = (typeof STEP_STATUSES)[number];

export const updateDashboardStepSchema = z.object({
  status: z.enum(STEP_STATUSES, { error: "Invalid status." }),
  remark: z
    .unknown()
    .transform(emptyToNull)
    .pipe(z.string().max(STEP_REMARK_MAX, `Remark must be at most ${STEP_REMARK_MAX} characters.`).nullable()),
});

export type LinkSegment = { text: string; href?: string };

const URL_PATTERN = /https?:\/\/[^\s<>"]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * Splits free text into plain and link segments so it can be rendered with
 * React elements (never dangerouslySetInnerHTML). Only http(s) URLs become
 * links; trailing sentence punctuation is left outside the link.
 */
export function linkifyText(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const trimmed = match[0].replace(TRAILING_PUNCTUATION, "");
    if (!trimmed || !isHttpUrl(trimmed)) continue;
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ text: trimmed, href: trimmed });
    last = start + trimmed.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/**
 * The exact phrase an admin must type to delete a site ("Delete site Tulsi Pune").
 * Case-sensitive on purpose: it is a deliberate speed bump, and the server
 * re-checks it with this same function (a replayed action call cannot skip it).
 */
export function deleteSiteConfirmPhrase(siteName: string): string {
  return `Delete site ${siteName}`;
}

export function isDeleteSiteConfirmed(siteName: string, typed: unknown): boolean {
  return typeof typed === "string" && typed.trim() === deleteSiteConfirmPhrase(siteName);
}
