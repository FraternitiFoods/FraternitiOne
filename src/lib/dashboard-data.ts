import "server-only";

import type { Role } from "@prisma/client";
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
  /** Real people assigned by Admin (plan.md section 12). Empty when not loaded (franchisee view) or nobody is assigned. */
  assignees: { id: string; name: string }[];
  children: StepNode[];
};

export type StageDetail = {
  siteId: string;
  stageNo: number;
  stageName: string;
  origin: "SHEET" | "WEBSITE";
  steps: StepNode[];
};

/**
 * Stage page tree (dashboard-sheet-sync-plan.md section 3): parent rows carry no status of their own — derived from children here, same rule as dashboard-calc.ts.
 * `includeAssignees` loads who each task is assigned to; leave it off for a franchisee, who must not receive colleagues' names.
 */
export async function getStageDetail(
  siteName: string,
  stageNo: number,
  options: { includeAssignees?: boolean } = {}
): Promise<StageDetail | null> {
  const site = await db.dashboardSite.findFirst({
    where: { name: siteName, isActive: true },
    select: { id: true, origin: true },
  });
  if (!site) return null;

  const rows = await db.dashboardStep.findMany({
    where: { siteId: site.id, stageNo },
    orderBy: { sortOrder: "asc" },
  });

  const assigneesByStep = new Map<string, { id: string; name: string }[]>();
  if (options.includeAssignees) {
    const assignments = await db.dashboardStepAssignment.findMany({
      where: { step: { siteId: site.id, stageNo } },
      select: { stepId: true, user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    for (const a of assignments) {
      const list = assigneesByStep.get(a.stepId) ?? [];
      list.push({ id: a.user.id, name: a.user.name });
      assigneesByStep.set(a.stepId, list);
    }
  }
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
      assignees: assigneesByStep.get(row.id) ?? [],
      children,
    };
  }

  const steps = rows.filter((r) => !r.parentKey).map(toNode);

  return { siteId: site.id, stageNo, stageName: rows[0].stageName, origin: site.origin, steps };
}

/**
 * Stage numbers in which `userId` holds >= 1 assigned task on this site — the
 * stages that user may open (dashboard-access.ts canOpenStage). Empty for a
 * sheet-synced site, where no assignments can exist.
 */
export async function getAssignedStageNos(userId: string, siteId: string): Promise<Set<number>> {
  const rows = await db.dashboardStepAssignment.findMany({
    where: { userId, step: { siteId } },
    select: { step: { select: { stageNo: true } } },
  });
  return new Set(rows.map((r) => r.step.stageNo));
}

export type TeamData = {
  site: { id: string; name: string; origin: "SHEET" | "WEBSITE" };
  stages: { stageNo: number; stageName: string; steps: { id: string; label: string }[] }[];
  /** People Admin can pick: active internal non-admins, plus anyone who still holds tasks here (so leftovers can be removed). */
  people: { id: string; name: string; email: string; role: Role; isActive: boolean }[];
  /** userId -> ids of the tasks they hold on this site (only users with >= 1). */
  assignedByUser: Record<string, string[]>;
};

/** Everything the Admin "Team" page needs for one site, in three queries. Null if the site doesn't exist / isn't active. */
export async function getTeamData(siteName: string): Promise<TeamData | null> {
  const site = await db.dashboardSite.findFirst({
    where: { name: siteName, isActive: true },
    select: { id: true, name: true, origin: true },
  });
  if (!site) return null;

  const [steps, assignments] = await Promise.all([
    db.dashboardStep.findMany({
      where: { siteId: site.id, isParent: false },
      orderBy: [{ stageNo: "asc" }, { sortOrder: "asc" }],
      select: { id: true, stageNo: true, stageName: true, label: true },
    }),
    db.dashboardStepAssignment.findMany({
      where: { step: { siteId: site.id } },
      select: { stepId: true, userId: true },
    }),
  ]);

  const stages: TeamData["stages"] = [];
  for (const s of steps) {
    let stage = stages[stages.length - 1];
    if (!stage || stage.stageNo !== s.stageNo) {
      stage = { stageNo: s.stageNo, stageName: s.stageName, steps: [] };
      stages.push(stage);
    }
    stage.steps.push({ id: s.id, label: s.label });
  }

  const assignedByUser: Record<string, string[]> = {};
  for (const a of assignments) (assignedByUser[a.userId] ??= []).push(a.stepId);

  const people = await db.user.findMany({
    where: {
      OR: [
        { isActive: true, role: { notIn: ["ADMIN", "FRANCHISEE"] } },
        { id: { in: Object.keys(assignedByUser) } },
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });

  return { site, stages, people, assignedByUser };
}

/** Ids of the steps in one stage that `userId` is assigned to — drives the "yours" highlight and which rows get edit controls. */
export async function getAssignedStepIds(userId: string, siteId: string, stageNo: number): Promise<Set<string>> {
  const rows = await db.dashboardStepAssignment.findMany({
    where: { userId, step: { siteId, stageNo } },
    select: { stepId: true },
  });
  return new Set(rows.map((r) => r.stepId));
}

/** dashboard-sheet-sync-plan.md section 2: "Admin assigns a site to a franchisee user inside the website (no mapping in the sheet)." */
export async function getAssignedSiteName(userId: string): Promise<string | null> {
  const assignment = await db.dashboardSiteAssignment.findUnique({ where: { userId }, include: { site: true } });
  return assignment?.site.name ?? null;
}
