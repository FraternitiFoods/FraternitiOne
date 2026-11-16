import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getDashboardStepTemplate } from "@/lib/dashboard-template";
import { ensureOpsBoqRows } from "@/lib/ops-boq-ensure";
import { DEFAULT_STEP_ASSIGNEE, normalizeSiteName } from "@/lib/dashboard-site-input";

/**
 * Shared by the two places that create a website-owned Dashboard site: the
 * Admin "New site" action (dashboard/actions.ts) and the Store Onboarding LOI
 * Complete conversion (onboarding/conversion.ts). One implementation so both
 * produce exactly the same rows: DashboardSite + its step template + the shared
 * `Site` row (so it appears in Site Tracker / Site BOQ / Operations BOQ) + the
 * 11 fixed Operations BOQ rows.
 */

export type SiteSlots = {
  /** A DashboardSite (any origin, active or archived) already has this name (case/whitespace-insensitive). */
  dashboardNameTaken: boolean;
  /** The shared Site table (tracker/BOQ) already has this name (case-insensitive). */
  trackerNameTaken: boolean;
  nextSortOrder: number;
  nextTrackerSortOrder: number;
};

/**
 * One parallel round trip: is `name` free, and what are the next sortOrders.
 * Case/whitespace-insensitive across ALL DashboardSite rows (including archived
 * sheet sites) because the sheet sync matches by the same normalised name; the
 * shared Site table has its own unique name. A lost race only means two sites
 * share a sortOrder (harmless) or hits the unique index (caller handles P2002).
 */
export async function findSiteSlots(name: string): Promise<SiteSlots> {
  const [existingSites, trackerNameTaken, siteSortMax] = await Promise.all([
    db.dashboardSite.findMany({ select: { name: true, sortOrder: true } }),
    db.site.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } }),
    db.site.aggregate({ _max: { sortOrder: true } }),
  ]);
  const wanted = normalizeSiteName(name);
  return {
    dashboardNameTaken: existingSites.some((s) => normalizeSiteName(s.name) === wanted),
    trackerNameTaken: trackerNameTaken !== null,
    nextSortOrder: existingSites.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1,
    nextTrackerSortOrder: (siteSortMax._max.sortOrder ?? -1) + 1,
  };
}

/**
 * For the automatic creation at LOI Complete: nobody is typing the name, so
 * instead of rejecting a taken name pick the first free one — `base`, then
 * `base (2)`, `base (3)`, ... Names are compared with the same normalisation
 * the duplicate checks use, against both DashboardSite and the shared Site
 * table. One parallel round trip.
 */
export async function findAvailableSiteName(
  base: string
): Promise<{ name: string; nextSortOrder: number; nextTrackerSortOrder: number }> {
  const [dashboardSites, trackerSites, siteSortMax] = await Promise.all([
    db.dashboardSite.findMany({ select: { name: true, sortOrder: true } }),
    db.site.findMany({ where: { name: { startsWith: base, mode: "insensitive" } }, select: { name: true } }),
    db.site.aggregate({ _max: { sortOrder: true } }),
  ]);
  const taken = new Set([...dashboardSites, ...trackerSites].map((s) => normalizeSiteName(s.name)));
  let name = base;
  for (let n = 2; taken.has(normalizeSiteName(name)); n++) name = `${base} (${n})`;
  return {
    name,
    nextSortOrder: dashboardSites.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1,
    nextTrackerSortOrder: (siteSortMax._max.sortOrder ?? -1) + 1,
  };
}

export type CreateWebsiteSiteInput = {
  name: string;
  driveFolderUrl: string | null;
  deptLinksText: string | null;
  sortOrder: number;
  trackerSortOrder: number;
};

export type CreatedWebsiteSite = {
  dashboardSiteId: string;
  trackerSiteId: string;
  opsBoqRows: number;
  steps: number;
};

/**
 * Creates the site + ~466 steps + shared Site row + Ops BOQ rows inside the
 * caller's transaction. The caller owns the audit event and the transaction
 * timeout (use `{ timeout: 30_000, maxWait: 10_000 }` — the step createMany is
 * the heavy part). `origin: WEBSITE` keeps the sheet sync's hands off it.
 */
export async function createWebsiteSiteInTx(
  tx: Prisma.TransactionClient,
  input: CreateWebsiteSiteInput
): Promise<CreatedWebsiteSite> {
  const template = getDashboardStepTemplate();

  const site = await tx.dashboardSite.create({
    data: {
      name: input.name,
      origin: "WEBSITE",
      driveFolderUrl: input.driveFolderUrl,
      deptLinksText: input.deptLinksText,
      sortOrder: input.sortOrder,
      isActive: true,
    },
  });

  // Makes the site appear in Site Tracker (dropdown + All sites) AND Site
  // BOQ (the website is the source of truth; BOQ queries filter on
  // usedInBoq). Tracker steps are lazy per-site rows, so this one row is
  // all it needs; `WEB-` sourceKey as in site-boq/sites/actions.ts.
  const trackerSite = await tx.site.create({
    data: {
      sourceKey: `WEB-${randomUUID()}`,
      name: input.name,
      sortOrder: input.trackerSortOrder,
      usedInBoq: true,
      usedInTracker: true,
    },
    select: { id: true },
  });

  // Operations BOQ: the 11 fixed rows, in this same transaction (idempotent).
  const opsBoqRows = await ensureOpsBoqRows(tx, trackerSite.id);

  await tx.dashboardStep.createMany({
    data: template.map((step) => ({
      siteId: site.id,
      stageNo: step.stageNo,
      stageName: step.stageName,
      stepKey: step.stepKey,
      parentKey: step.parentKey,
      label: step.label,
      sortOrder: step.sortOrder,
      isParent: step.isParent,
      assignedTo: DEFAULT_STEP_ASSIGNEE,
      status: step.isParent ? null : ("NOT_STARTED" as const),
      shared: false,
      deliverables: [],
    })),
  });

  return { dashboardSiteId: site.id, trackerSiteId: trackerSite.id, opsBoqRows, steps: template.length };
}
