import { describe, expect, it } from "vitest";
import { buildStatusView, STATUS_TIMEOUT_MS } from "./view";

const T0 = new Date("2026-11-16T10:00:00Z");
const leg = (over: Partial<Parameters<typeof buildStatusView>[0] extends infer B ? (B extends { legs: (infer L)[] } ? L : never) : never>) => ({
  leg: "STAGES" as const,
  status: "RUNNING" as const,
  startedAt: T0,
  finishedAt: null,
  counts: null,
  warnings: null,
  createdSites: null,
  errorMessage: null,
  ...over,
});

describe("buildStatusView", () => {
  it("no batch yet -> idle", () => {
    expect(buildStatusView(null, null, T0)).toMatchObject({ batchId: null, active: false, legs: [] });
  });

  it("a running leg makes the batch active; legs come out in fixed order", () => {
    const view = buildStatusView(
      {
        id: "b1",
        startedAt: T0,
        finishedAt: null,
        legs: [leg({ leg: "OPS_BOQ" }), leg({ leg: "STAGES", status: "COMMITTED", counts: { sites: 3 } })],
      },
      null,
      new Date(T0.getTime() + 5_000)
    );
    expect(view.active).toBe(true);
    expect(view.legs.map((l) => [l.leg, l.state])).toEqual([
      ["STAGES", "done"],
      ["OPS_BOQ", "running"],
    ]);
  });

  it("shows (without writing) a leg running past the timeout as failed", () => {
    const view = buildStatusView(
      { id: "b1", startedAt: T0, finishedAt: null, legs: [leg({})] },
      null,
      new Date(T0.getTime() + STATUS_TIMEOUT_MS + 1)
    );
    expect(view.legs[0]).toMatchObject({ state: "failed", error: expect.stringContaining("Timed out") });
    expect(view.active).toBe(false);
  });

  it("surfaces created sites, warning count and a failed leg's error", () => {
    const view = buildStatusView(
      {
        id: "b1",
        startedAt: T0,
        finishedAt: T0,
        legs: [
          leg({ leg: "STAGES", status: "COMMITTED", createdSites: ["Tulsi X"], warnings: ["w1", "w2"] }),
          leg({ leg: "SITE_BOQ", status: "FAILED", errorMessage: "Count mismatch" }),
        ],
      },
      T0,
      T0
    );
    expect(view.legs[0]).toMatchObject({ createdSites: ["Tulsi X"], warningCount: 2 });
    expect(view.legs[1]).toMatchObject({ state: "failed", error: "Count mismatch" });
    expect(view.lastCommittedAt).toBe(T0.toISOString());
  });
});
