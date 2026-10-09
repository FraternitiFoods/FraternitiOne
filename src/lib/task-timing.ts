import type { Department, LifecycleStage, TaskStatus } from "@prisma/client";

/**
 * plan.md section 24 S2 — pure lateness functions, no DB access (so this can
 * be unit-tested directly and imported from server components without
 * pulling in Prisma). Deliberately NOT `"server-only"`: see the module doc
 * on `effectiveDue` for why callers always pass already-fetched rows in.
 *
 * Rule 1 (plan.md section 24): a task with no manual due date and no SLA is
 * "untracked" — it must never be guessed into a delay number. Rule 4: all
 * date comparisons are IST calendar days, not raw timestamps (the server
 * runs in UTC; a naive `Date` compare is off by one around IST midnight).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar date (`YYYY-MM-DD`) a UTC instant falls on. */
export function toIstDateKey(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `toKey`'s calendar date minus `fromKey`'s, in whole days. */
function istDayDiff(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export type TaskTimingInput = {
  status: TaskStatus;
  dueDate: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  slaDays: number | null;
};

/**
 * The due date actually in effect: a manually-set `dueDate` always wins;
 * otherwise `startedAt + slaDays` once both exist; otherwise none ("not
 * tracked" — never guessed from, say, `createdAt`).
 */
export function effectiveDue(task: Pick<TaskTimingInput, "dueDate" | "startedAt" | "slaDays">): Date | null {
  if (task.dueDate) return task.dueDate;
  if (task.startedAt && task.slaDays != null) {
    return new Date(task.startedAt.getTime() + task.slaDays * 86_400_000);
  }
  return null;
}

export type TaskTiming =
  | { kind: "UNTRACKED" }
  | { kind: "CANCELLED" }
  | { kind: "ON_TRACK"; dueDate: Date }
  | { kind: "DUE_SOON"; dueDate: Date; isToday: boolean }
  | { kind: "OVERDUE"; dueDate: Date; daysOverdue: number }
  | { kind: "ON_TIME_DONE" }
  | { kind: "LATE_DONE"; daysLate: number };

/**
 * The one place that turns a task's raw timestamps into a lateness verdict.
 * `now` is injectable for tests; every caller in the app passes the default.
 *
 * A reopened task (plan.md section 24 definition of done): `status` is no
 * longer `COMPLETED`, `completedAt` is cleared but `startedAt` is kept by
 * `applyTaskStatusChange` (task-status.ts) — so it falls through to the open-
 * task branch below and keeps counting from its original `effectiveDue`,
 * exactly as the plan requires (no clock restart on reopen).
 */
export function getTaskTiming(task: TaskTimingInput, now: Date = new Date()): TaskTiming {
  if (task.status === "CANCELLED") return { kind: "CANCELLED" };

  const due = effectiveDue(task);

  if (task.status === "COMPLETED") {
    if (!due || !task.completedAt) return { kind: "ON_TIME_DONE" };
    const diff = istDayDiff(toIstDateKey(due), toIstDateKey(task.completedAt));
    return diff > 0 ? { kind: "LATE_DONE", daysLate: diff } : { kind: "ON_TIME_DONE" };
  }

  if (!due) return { kind: "UNTRACKED" };

  const diff = istDayDiff(toIstDateKey(due), toIstDateKey(now)); // > 0 => today is after due
  if (diff > 0) return { kind: "OVERDUE", dueDate: due, daysOverdue: diff };
  if (diff === 0) return { kind: "DUE_SOON", dueDate: due, isToday: true };
  if (diff === -1) return { kind: "DUE_SOON", dueDate: due, isToday: false };
  return { kind: "ON_TRACK", dueDate: due };
}

/** `null` for the "nothing worth flagging" states (ON_TRACK/UNTRACKED/CANCELLED/ON_TIME_DONE) — the existing status badge already covers those. */
export function formatTaskTimingBadge(timing: TaskTiming): { label: string; className: string } | null {
  switch (timing.kind) {
    case "OVERDUE":
      return {
        label: `${timing.daysOverdue} day${timing.daysOverdue === 1 ? "" : "s"} late`,
        className: "border-transparent bg-red-100 text-red-700",
      };
    case "DUE_SOON":
      return {
        label: timing.isToday ? "Due today" : "Due tomorrow",
        className: "border-transparent bg-amber-100 text-amber-700",
      };
    case "LATE_DONE":
      return {
        label: `Finished ${timing.daysLate} day${timing.daysLate === 1 ? "" : "s"} late`,
        className: "border-transparent bg-orange-100 text-orange-700",
      };
    default:
      return null;
  }
}

/**
 * Rule 9 (plan.md section 24): a franchisee must never be blamed for delay a
 * franchisee themselves is holding up. A task currently `AWAITING_FRANCHISEE`
 * is bucketed under the `"FRANCHISEE"` sentinel instead of its own
 * `Task.module`, regardless of which internal department owns it.
 */
export const FRANCHISEE_DELAY_BUCKET = "FRANCHISEE" as const;

export function delayBucketKey(task: { module: Department; status: TaskStatus }): Department | "FRANCHISEE" {
  return task.status === "AWAITING_FRANCHISEE" ? FRANCHISEE_DELAY_BUCKET : task.module;
}

export type DelaySummaryTask = {
  id: string;
  title: string;
  module: Department;
  lifecycleStage: LifecycleStage;
  status: TaskStatus;
  dueDate: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  slaDays: number | null;
  ownerName: string;
};

export type DelayBucket<K extends string> = { key: K; count: number; totalDaysOverdue: number };

export type DelaySummary = {
  runningOnTrack: number;
  runningOverdue: number;
  finishedOnTime: number;
  finishedLate: number;
  /** Over currently-OVERDUE tasks only; 0 when there are none. */
  averageDaysOverdue: number;
  byDepartment: DelayBucket<Department | "FRANCHISEE">[];
  byStage: DelayBucket<LifecycleStage>[];
  /** Most-late open tasks first, capped at `topN`. */
  topLate: (DelaySummaryTask & { daysOverdue: number })[];
};

/**
 * Computed on read, every time, from whatever bounded task set the caller
 * already fetched (plan.md section 24 rule 3: nothing here is ever stored).
 * Untracked/cancelled tasks are excluded entirely (rule 1) — they were never
 * loaded into the trackable set to begin with, or just don't match any kind
 * this function counts.
 */
export function summarizeDelays(
  tasks: DelaySummaryTask[],
  opts: { now?: Date; topN?: number } = {}
): DelaySummary {
  const now = opts.now ?? new Date();
  const topN = opts.topN ?? 5;

  let runningOnTrack = 0;
  let runningOverdue = 0;
  let finishedOnTime = 0;
  let finishedLate = 0;
  let overdueDaysSum = 0;

  const byDepartment = new Map<Department | "FRANCHISEE", DelayBucket<Department | "FRANCHISEE">>();
  const byStage = new Map<LifecycleStage, DelayBucket<LifecycleStage>>();
  const topLate: (DelaySummaryTask & { daysOverdue: number })[] = [];

  for (const task of tasks) {
    const timing = getTaskTiming(task, now);
    switch (timing.kind) {
      case "ON_TRACK":
      case "DUE_SOON":
        runningOnTrack += 1;
        break;
      case "ON_TIME_DONE":
        finishedOnTime += 1;
        break;
      case "LATE_DONE":
        finishedLate += 1;
        break;
      case "OVERDUE": {
        runningOverdue += 1;
        overdueDaysSum += timing.daysOverdue;
        topLate.push({ ...task, daysOverdue: timing.daysOverdue });

        const deptKey = delayBucketKey(task);
        const deptBucket = byDepartment.get(deptKey) ?? { key: deptKey, count: 0, totalDaysOverdue: 0 };
        deptBucket.count += 1;
        deptBucket.totalDaysOverdue += timing.daysOverdue;
        byDepartment.set(deptKey, deptBucket);

        const stageBucket = byStage.get(task.lifecycleStage) ?? {
          key: task.lifecycleStage,
          count: 0,
          totalDaysOverdue: 0,
        };
        stageBucket.count += 1;
        stageBucket.totalDaysOverdue += timing.daysOverdue;
        byStage.set(task.lifecycleStage, stageBucket);
        break;
      }
      // UNTRACKED/CANCELLED: excluded from every number (rule 1).
    }
  }

  topLate.sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    runningOnTrack,
    runningOverdue,
    finishedOnTime,
    finishedLate,
    averageDaysOverdue: runningOverdue === 0 ? 0 : Math.round((overdueDaysSum / runningOverdue) * 10) / 10,
    byDepartment: Array.from(byDepartment.values()).sort((a, b) => b.totalDaysOverdue - a.totalDaysOverdue),
    byStage: Array.from(byStage.values()).sort((a, b) => b.totalDaysOverdue - a.totalDaysOverdue),
    topLate: topLate.slice(0, topN),
  };
}
