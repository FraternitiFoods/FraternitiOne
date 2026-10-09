import { describe, it, expect, vi, beforeEach } from "vitest";

// task-status.ts (and audit.ts, which it calls into) import "server-only" —
// stub it for this unit test, same pattern as webhook-processor.test.ts.
vi.mock("server-only", () => ({}));

import { applyTaskStatusChange } from "./task-status";
import type { CurrentUser } from "@/lib/session";

const actor: CurrentUser = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  role: "ADMIN",
  department: null,
};

function makeTx(updatedOverrides: Record<string, unknown> = {}) {
  const update = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "task-1",
      ...data,
      ...updatedOverrides,
    })
  );
  const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
  return {
    task: { update },
    auditEvent: { create: auditCreate },
  } as unknown as Parameters<typeof applyTaskStatusChange>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyTaskStatusChange", () => {
  it("sets startedAt the first time a task leaves NOT_STARTED", async () => {
    const tx = makeTx();
    const task = { id: "task-1", status: "NOT_STARTED" as const, startedAt: null, completionEvidence: null };

    await applyTaskStatusChange(tx, task, "IN_PROGRESS", actor);

    const call = (tx.task.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.startedAt).toBeInstanceOf(Date);
    expect(call.data.status).toBe("IN_PROGRESS");
    expect(call.data.completedAt).toBeNull();
  });

  it("does not overwrite an existing startedAt on a later transition", async () => {
    const tx = makeTx();
    const existingStartedAt = new Date("2026-01-01T00:00:00Z");
    const task = {
      id: "task-1",
      status: "IN_PROGRESS" as const,
      startedAt: existingStartedAt,
      completionEvidence: null,
    };

    await applyTaskStatusChange(tx, task, "BLOCKED", actor);

    const call = (tx.task.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.startedAt).toBe(existingStartedAt);
    expect(call.data.completedAt).toBeNull();
  });

  it("sets completedAt when completing a task", async () => {
    const tx = makeTx();
    const task = {
      id: "task-1",
      status: "IN_PROGRESS" as const,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      completionEvidence: null,
    };

    await applyTaskStatusChange(tx, task, "COMPLETED", actor, { completionEvidence: "done" });

    const call = (tx.task.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.completedAt).toBeInstanceOf(Date);
    expect(call.data.completionEvidence).toBe("done");
  });

  it("clears completedAt and keeps startedAt when a completed task is reopened", async () => {
    const tx = makeTx();
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const task = {
      id: "task-1",
      status: "COMPLETED" as const,
      startedAt,
      completionEvidence: "done",
    };

    await applyTaskStatusChange(tx, task, "IN_PROGRESS", actor);

    const call = (tx.task.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.completedAt).toBeNull();
    expect(call.data.startedAt).toBe(startedAt);
    // Reopening doesn't pass completionEvidence, so the prior evidence is kept.
    expect(call.data.completionEvidence).toBe("done");
  });

  it("touches neither timestamp on a plain in-progress-to-blocked transition", async () => {
    const tx = makeTx();
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const task = { id: "task-1", status: "IN_PROGRESS" as const, startedAt, completionEvidence: null };

    await applyTaskStatusChange(tx, task, "BLOCKED", actor);

    const call = (tx.task.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.startedAt).toBe(startedAt);
    expect(call.data.completedAt).toBeNull();
  });

  it("always writes an AuditEvent with old -> new status", async () => {
    const tx = makeTx();
    const task = { id: "task-1", status: "NOT_STARTED" as const, startedAt: null, completionEvidence: null };

    await applyTaskStatusChange(tx, task, "IN_PROGRESS", actor, {
      reference: "test reference",
      source: "mobile",
      projectId: "project-1",
    });

    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
    const data = (tx.auditEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data.entityType).toBe("Task");
    expect(data.entityId).toBe("task-1");
    expect(data.action).toBe("UPDATE");
    expect(data.oldValue).toEqual({ status: "NOT_STARTED", completionEvidence: null });
    expect(data.newValue).toEqual({ status: "IN_PROGRESS", completionEvidence: null });
    expect(data.reference).toBe("test reference");
    expect(data.source).toBe("mobile");
    expect(data.projectId).toBe("project-1");
  });
});
