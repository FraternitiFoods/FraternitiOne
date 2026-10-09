import { describe, it, expect } from "vitest";
import { effectiveDue, getTaskTiming, toIstDateKey, summarizeDelays } from "./task-timing";
import type { TaskTimingInput, DelaySummaryTask } from "./task-timing";

function task(overrides: Partial<TaskTimingInput> = {}): TaskTimingInput {
  return {
    status: "IN_PROGRESS",
    dueDate: null,
    startedAt: null,
    completedAt: null,
    slaDays: null,
    ...overrides,
  };
}

describe("toIstDateKey", () => {
  it("rolls over to the next IST calendar day across UTC midnight", () => {
    // 18:35 UTC = 00:05 IST the next day.
    expect(toIstDateKey(new Date("2026-01-01T18:35:00Z"))).toBe("2026-01-02");
  });

  it("stays on the same day well before the IST rollover", () => {
    expect(toIstDateKey(new Date("2026-01-01T10:00:00Z"))).toBe("2026-01-01");
  });
});

describe("effectiveDue", () => {
  it("prefers the manual due date over slaDays", () => {
    const due = effectiveDue({
      dueDate: new Date("2026-02-01T00:00:00Z"),
      startedAt: new Date("2026-01-01T00:00:00Z"),
      slaDays: 5,
    });
    expect(due?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("falls back to startedAt + slaDays when there is no manual due date", () => {
    const due = effectiveDue({
      dueDate: null,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      slaDays: 5,
    });
    expect(due?.toISOString()).toBe("2026-01-06T00:00:00.000Z");
  });

  it("is null (not tracked) when neither is available", () => {
    expect(effectiveDue({ dueDate: null, startedAt: null, slaDays: 5 })).toBeNull();
    expect(effectiveDue({ dueDate: null, startedAt: new Date(), slaDays: null })).toBeNull();
  });
});

describe("getTaskTiming", () => {
  it("is UNTRACKED for a task with no due date and no SLA, even if started", () => {
    const timing = getTaskTiming(
      task({ status: "IN_PROGRESS", startedAt: new Date("2026-01-01T00:00:00Z") })
    );
    expect(timing.kind).toBe("UNTRACKED");
  });

  it("is CANCELLED regardless of how overdue the due date looks", () => {
    const timing = getTaskTiming(
      task({ status: "CANCELLED", dueDate: new Date("2020-01-01T00:00:00Z") }),
      new Date("2026-01-01T00:00:00Z")
    );
    expect(timing.kind).toBe("CANCELLED");
  });

  it("is DUE_SOON (today) when the due date is today", () => {
    const now = new Date("2026-01-10T06:00:00Z"); // 11:30 IST
    const timing = getTaskTiming(task({ dueDate: new Date("2026-01-10T00:00:00Z") }), now);
    expect(timing).toMatchObject({ kind: "DUE_SOON", isToday: true });
  });

  it("is DUE_SOON (tomorrow) when the due date is tomorrow", () => {
    const now = new Date("2026-01-10T06:00:00Z");
    const timing = getTaskTiming(task({ dueDate: new Date("2026-01-11T00:00:00Z") }), now);
    expect(timing).toMatchObject({ kind: "DUE_SOON", isToday: false });
  });

  it("is OVERDUE with the right day count once past the IST midnight boundary", () => {
    // Due 2026-01-10. Now is 2026-01-13T19:00Z = 2026-01-14T00:30 IST → 4 IST-calendar days late.
    const now = new Date("2026-01-13T19:00:00Z");
    const timing = getTaskTiming(task({ dueDate: new Date("2026-01-10T00:00:00Z") }), now);
    expect(timing).toMatchObject({ kind: "OVERDUE", daysOverdue: 4 });
  });

  it("is ON_TRACK when the due date is more than a day away", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const timing = getTaskTiming(task({ dueDate: new Date("2026-01-05T00:00:00Z") }), now);
    expect(timing.kind).toBe("ON_TRACK");
  });

  it("is LATE_DONE when completed after its effective due date", () => {
    const timing = getTaskTiming(
      task({
        status: "COMPLETED",
        dueDate: new Date("2026-01-05T00:00:00Z"),
        completedAt: new Date("2026-01-08T00:00:00Z"),
      })
    );
    expect(timing).toMatchObject({ kind: "LATE_DONE", daysLate: 3 });
  });

  it("is ON_TIME_DONE when completed on or before its effective due date", () => {
    const timing = getTaskTiming(
      task({
        status: "COMPLETED",
        dueDate: new Date("2026-01-05T00:00:00Z"),
        completedAt: new Date("2026-01-05T00:00:00Z"),
      })
    );
    expect(timing.kind).toBe("ON_TIME_DONE");
  });

  it("is ON_TIME_DONE (never guessed late) when completed with no due date at all", () => {
    const timing = getTaskTiming(
      task({ status: "COMPLETED", completedAt: new Date("2026-01-05T00:00:00Z") })
    );
    expect(timing.kind).toBe("ON_TIME_DONE");
  });

  it("a reopened task keeps its original startedAt-derived due date instead of restarting the clock", () => {
    // Started 10 days ago with a 5-day SLA, then completed-and-reopened:
    // status is back to IN_PROGRESS, completedAt cleared, startedAt kept —
    // exactly what applyTaskStatusChange (task-status.ts) does on reopen.
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-11T00:00:00Z"); // 10 days after start, SLA was 5
    const timing = getTaskTiming(
      task({ status: "IN_PROGRESS", startedAt, slaDays: 5, completedAt: null }),
      now
    );
    expect(timing).toMatchObject({ kind: "OVERDUE", daysOverdue: 5 });
  });
});

describe("summarizeDelays", () => {
  function delayTask(overrides: Partial<DelaySummaryTask> = {}): DelaySummaryTask {
    return {
      id: "t1",
      title: "Task",
      module: "LEGAL",
      lifecycleStage: "LEGAL_COMPLIANCE",
      status: "IN_PROGRESS",
      dueDate: null,
      startedAt: null,
      completedAt: null,
      slaDays: null,
      ownerName: "Owner",
      ...overrides,
    };
  }

  it("excludes untracked and cancelled tasks from every count", () => {
    const summary = summarizeDelays([
      delayTask({ id: "untracked" }),
      delayTask({ id: "cancelled", status: "CANCELLED", dueDate: new Date("2020-01-01T00:00:00Z") }),
    ]);
    expect(summary.runningOnTrack).toBe(0);
    expect(summary.runningOverdue).toBe(0);
    expect(summary.byDepartment).toHaveLength(0);
    expect(summary.topLate).toHaveLength(0);
  });

  it("buckets an AWAITING_FRANCHISEE overdue task under FRANCHISEE, not its department", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const summary = summarizeDelays(
      [
        delayTask({
          id: "waiting-on-franchisee",
          module: "LEGAL",
          status: "AWAITING_FRANCHISEE",
          dueDate: new Date("2026-01-05T00:00:00Z"),
        }),
      ],
      { now }
    );
    expect(summary.byDepartment).toEqual([{ key: "FRANCHISEE", count: 1, totalDaysOverdue: 5 }]);
  });

  it("ranks topLate by days overdue, most late first", () => {
    const now = new Date("2026-01-20T00:00:00Z");
    const summary = summarizeDelays(
      [
        delayTask({ id: "a", dueDate: new Date("2026-01-18T00:00:00Z") }), // 2 late
        delayTask({ id: "b", dueDate: new Date("2026-01-10T00:00:00Z") }), // 10 late
        delayTask({ id: "c", dueDate: new Date("2026-01-15T00:00:00Z") }), // 5 late
      ],
      { now }
    );
    expect(summary.topLate.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(summary.averageDaysOverdue).toBeCloseTo((2 + 10 + 5) / 3, 1);
  });
});
