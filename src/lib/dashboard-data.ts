import "server-only";

import { db } from "@/lib/db";
import { computeSiteStats, deriveParentStatus, type LeafStepLike, type SiteStats } from "@/lib/dashboard-calc";

/**
 * Leaf-step counts grouped in SQL instead of shipping every step row (a site
 * has ~400 rows, the ranking ~10k, each with label/remark/deliverables) just
 * to count them. The groups are expanded back into LeafStepLike rows so the
 * percentage rules stay in one place (dashboard-calc.ts).
 */
async function loadLeafStepCounts(siteIds: string[]) {
  if (siteIds.length === 0) return [];
  return db.dashboardStep.groupBy({
    by: ["siteId", "stageNo", "stageName", "status", "shared"],
    where: { siteId: { in: siteIds }, isParent: false },
    _count: { _all: true },
  });
}

type LeafCountRow = Awaited<ReturnType<typeof loadLeafStepCounts>>[number];

function expandLeafCounts(rows: LeafCountRow[]): LeafStepLike[] {
  return rows.flatMap((r) =>
    Array.from({ length: r._count._all }, () => ({
      stageNo: r.stageNo,
      isParent: false,
      status: r.status,
      shared: r.shared,
    }))
  );
}

/** Home page ranking row (dashboard-sheet-sync-plan.md section 6: "ranking bars (site overall %, high to low)"). */
export type SiteRanking = {
  name: string;
  pct: number;
  completed: number;
  total: number;
  lastSyncedAt: Date | null;
  origin: "SHEET" | "WEBSITE";
};

export async function getDashboardRanking(): Promise<SiteRanking[]> {
  const sites = await db.dashboardSite.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const counts = await loadLeafStepCounts(sites.map((s) => s.id));
  const countsBySite = new Map<string, LeafCountRow[]>();
  for (const row of counts) {
    const list = countsBySite.get(row.siteId) ?? [];
    list.push(row);
    countsBySite.set(row.siteId, list);
  }

  return sites
    .map((site) => {
      const stats = computeSiteStats(expandLeafCounts(countsBySite.get(site.id) ?? []));
      return {
        name: site.name,
        pct: stats.pct,
        completed: stats.completed,
        total: stats.total,
        lastSyncedAt: site.lastSyncedAt,
        origin: site.origin,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

export type StageSummary = { stageNo: number; stageName: string; completed: number; applicable: number; pct: number };

export type SiteDetail = {
  id: string;
  name: string;
  origin: "SHEET" | "WEBSITE";
  deptLinksText: string | null;
  driveFolderUrl: string | null;
  lastSyncedAt: Date | null;
  overall: SiteStats;
  stages: StageSummary[];
  deptLinks: { department: string; stageFolderName: string; url: string }[];
};

export async function getSiteDetail(siteName: string): Promise<SiteDetail | null> {
  const site = await db.dashboardSite.findFirst({
    where: { name: siteName, isActive: true },
    include: { deptLinks: { orderBy: { stageFolderName: "asc" } } },
  });
  if (!site) return null;

  const counts = await loadLeafStepCounts([site.id]);
  const overall = computeSiteStats(expandLeafCounts(counts));

  const stageNames = new Map<number, string>();
  for (const row of counts) {
    if (!stageNames.has(row.stageNo)) stageNames.set(row.stageNo, row.stageName);
  }

  const stages: StageSummary[] = overall.perStage.map((s) => ({
    stageNo: s.stageNo,
    stageName: stageNames.get(s.stageNo) ?? `Stage ${s.stageNo}`,
    completed: s.completed,
    applicable: s.applicable,
    pct: s.pct,
  }));

  return {
    id: site.id,
    name: site.name,
    origin: site.origin,
    deptLinksText: site.deptLinksText,
    driveFolderUrl: site.driveFolderUrl,
    lastSyncedAt: site.lastSyncedAt,
    overall,
    stages,
    deptLinks: site.deptLinks.map((d) => ({ department: d.department, stageFolderName: d.stageFolderName, url: d.url })),
  };
}

export type StepNode = {
  id: string;
  stepKey: string;
  label: string;
  assignedTo: string | null;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED";
  remark: string | null;
  shared: boolean;
  deliverables: { name: string; url: string }[];
  isParent: boolean;
  children: StepNode[];
};

export type StageDetail = { stageNo: number; stageName: string; origin: "SHEET" | "WEBSITE"; steps: StepNode[] };

/** Stage page tree (dashboard-sheet-sync-plan.md section 3): parent rows carry no status of their own — derived from children here, same rule as dashboard-calc.ts. */
export async function getStageDetail(siteName: string, stageNo: number): Promise<StageDetail | null> {
  const site = await db.dashboardSite.findFirst({
    where: { name: siteName, isActive: true },
    select: { id: true, origin: true },
  });
  if (!site) return null;

  const rows = await db.dashboardStep.findMany({
    where: { siteId: site.id, stageNo },
    orderBy: { sortOrder: "asc" },
  });
  if (rows.length === 0) return null;

  const childrenByParent = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.parentKey) {
      const list = childrenByParent.get(row.parentKey) ?? [];
      list.push(row);
      childrenByParent.set(row.parentKey, list);
    }
  }

  function toNode(row: (typeof rows)[number]): StepNode {
    const children = (childrenByParent.get(row.stepKey) ?? []).map(toNode);
    const status = row.isParent
      ? deriveParentStatus(children.map((c) => c.status))
      : row.status ?? "NOT_STARTED";
    return {
      id: row.id,
      stepKey: row.stepKey,
      label: row.label,
      assignedTo: row.assignedTo,
      status,
      remark: row.remark,
      shared: row.shared,
      deliverables: (row.deliverables as { name: string; url: string }[] | null) ?? [],
      isParent: row.isParent,
      children,
    };
  }

  const steps = rows.filter((r) => !r.parentKey).map(toNode);

  return { stageNo, stageName: rows[0].stageName, origin: site.origin, steps };
}

/** dashboard-sheet-sync-plan.md section 2: "Admin assigns a site to a franchisee user inside the website (no mapping in the sheet)." */
export async function getAssignedSiteName(userId: string): Promise<string | null> {
  const assignment = await db.dashboardSiteAssignment.findUnique({ where: { userId }, include: { site: true } });
  return assignment?.site.name ?? null;
}
