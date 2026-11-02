import "server-only";

import type { TrackerStepStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { trackerProgressPercent } from "@/lib/tracker-calc";

export type TrackerStatusCounts = {
  notStarted: number;
  inProgress: number;
  completed: number;
  notRequired: number;
  total: number;
};

export type TrackerEvidenceRow = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "IMAGE" | "VIDEO";
  createdAt: Date;
};

export type TrackerStepRow = {
  id: string;
  code: string;
  name: string;
  order: number;
  synthetic: boolean;
  sectionId: string;
  siteStepId: string | null;
  status: TrackerStepStatus;
  assignee: string | null;
  remark: string | null;
  notRequiredReason: string | null;
  completedAt: Date | null;
  completedByName: string | null;
  legacyCompleted: boolean;
  updatedAt: Date | null;
  updatedByName: string | null;
  evidence: TrackerEvidenceRow[];
};

export type TrackerSectionWithSteps = {
  id: string;
  name: string;
  order: number;
  steps: TrackerStepRow[];
};

function countStatuses(sections: TrackerSectionWithSteps[]): TrackerStatusCounts {
  const counts: TrackerStatusCounts = { notStarted: 0, inProgress: 0, completed: 0, notRequired: 0, total: 0 };
  for (const section of sections) {
    for (const step of section.steps) {
      counts.total += 1;
      if (step.status === "NOT_STARTED") counts.notStarted += 1;
      else if (step.status === "IN_PROGRESS") counts.inProgress += 1;
      else if (step.status === "COMPLETED") counts.completed += 1;
      else counts.notRequired += 1;
    }
  }
  return counts;
}

/**
 * Every active section/step with that site's row joined in (lazy: no row ->
 * NOT_STARTED, site-tracker-plan.md section 3). The one query the summary,
 * the accordion UI and "mark complete" dialogs all read from, so the status/
 * evidence-count rule can't drift between them.
 */
export async function getSiteTrackerSections(siteId: string): Promise<TrackerSectionWithSteps[]> {
  const sections = await db.trackerSection.findMany({
    where: { isActive: true },
    orderBy: { order: "asc" },
    include: {
      steps: {
        where: { isActive: true },
        orderBy: { order: "asc" },
        include: {
          siteSteps: {
            where: { siteId },
            include: {
              completedBy: { select: { name: true } },
              updatedBy: { select: { name: true } },
              evidence: {
                orderBy: { createdAt: "asc" },
                select: { id: true, fileName: true, mimeType: true, sizeBytes: true, kind: true, createdAt: true },
              },
            },
          },
        },
      },
    },
  });

  return sections.map((section) => ({
    id: section.id,
    name: section.name,
    order: section.order,
    steps: section.steps.map((step) => {
      // Unique([siteId, stepId]) — at most one row per step for this site.
      const siteStep = step.siteSteps[0];
      return {
        id: step.id,
        code: step.code,
        name: step.name,
        order: step.order,
        synthetic: step.synthetic,
        sectionId: section.id,
        siteStepId: siteStep?.id ?? null,
        status: siteStep?.status ?? "NOT_STARTED",
        assignee: siteStep?.assignee ?? null,
        remark: siteStep?.remark ?? null,
        notRequiredReason: siteStep?.notRequiredReason ?? null,
        completedAt: siteStep?.completedAt ?? null,
        completedByName: siteStep?.completedBy?.name ?? null,
        legacyCompleted: siteStep?.legacyCompleted ?? false,
        updatedAt: siteStep?.updatedAt ?? null,
        updatedByName: siteStep?.updatedBy?.name ?? null,
        evidence: siteStep?.evidence ?? [],
      };
    }),
  }));
}

export type SiteTrackerSummary = {
  site: { id: string; name: string };
  counts: TrackerStatusCounts;
  progressPercent: number;
  sections: TrackerSectionWithSteps[];
};

/**
 * site-tracker-plan.md section 4 helper #1. Returns null when the site
 * doesn't exist or isn't a tracker site (usedInTracker = false) — callers
 * treat that as "not found."
 */
export async function getSiteTrackerSummary(siteId: string): Promise<SiteTrackerSummary | null> {
  const site = await db.site.findUnique({ where: { id: siteId } });
  if (!site || !site.usedInTracker) return null;

  const sections = await getSiteTrackerSections(siteId);
  const counts = countStatuses(sections);
  const progressPercent = trackerProgressPercent({
    completed: counts.completed,
    notRequired: counts.notRequired,
    totalSteps: counts.total,
  });

  return { site: { id: site.id, name: site.name }, counts, progressPercent, sections };
}

/** Tracker site list — every Site with usedInTracker (site-tracker-plan.md: shared Site table, own on/off flag). Ignores isActive on purpose: hiding a site from Site BOQ must not also pull it out of the Tracker (the two modules' visibility is independent). */
export async function getTrackerSites() {
  return db.site.findMany({
    where: { usedInTracker: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export type SiteProgressRow = {
  site: { id: string; name: string };
  counts: TrackerStatusCounts;
  progressPercent: number;
};

/**
 * site-tracker-plan.md section 4 helper #2 / section 6 "All sites" tab. One
 * groupBy query across every tracker site's TrackerSiteStep rows instead of
 * N+1 per-site queries — notStarted is derived (total active steps minus the
 * other three buckets) rather than read off the groupBy, since a step with
 * no row at all (the common case) has no NOT_STARTED row to group.
 */
export async function getAllSitesProgress(): Promise<SiteProgressRow[]> {
  const sites = await getTrackerSites();
  const totalSteps = await db.trackerStep.count({ where: { isActive: true } });

  const grouped = await db.trackerSiteStep.groupBy({
    by: ["siteId", "status"],
    _count: { _all: true },
    where: { step: { isActive: true } },
  });

  const bySite = new Map<string, { inProgress: number; completed: number; notRequired: number }>();
  for (const site of sites) bySite.set(site.id, { inProgress: 0, completed: 0, notRequired: 0 });

  for (const row of grouped) {
    const entry = bySite.get(row.siteId);
    if (!entry) continue;
    if (row.status === "IN_PROGRESS") entry.inProgress = row._count._all;
    else if (row.status === "COMPLETED") entry.completed = row._count._all;
    else if (row.status === "NOT_REQUIRED") entry.notRequired = row._count._all;
  }

  return sites.map((site) => {
    const entry = bySite.get(site.id)!;
    const notStarted = totalSteps - entry.inProgress - entry.completed - entry.notRequired;
    const counts: TrackerStatusCounts = {
      notStarted,
      inProgress: entry.inProgress,
      completed: entry.completed,
      notRequired: entry.notRequired,
      total: totalSteps,
    };
    return {
      site: { id: site.id, name: site.name },
      counts,
      progressPercent: trackerProgressPercent({
        completed: counts.completed,
        notRequired: counts.notRequired,
        totalSteps: counts.total,
      }),
    };
  });
}
