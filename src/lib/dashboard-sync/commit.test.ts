import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { upsertSites } from "./commit";
import type { SiteInput } from "./schema";

type Row = { id: string; name: string; origin: "SHEET" | "WEBSITE"; isActive: boolean; lastSeenRunId: string | null };

/** Minimal fake of the tx client: only what upsertSites touches. */
function fakeTx(existing: Row[]) {
  const update = vi.fn(async () => ({}));
  const create = vi.fn(async ({ data }: { data: { name: string } }) => ({ id: "new-id", name: data.name }));
  const updateMany = vi.fn(async () => ({}));
  const tx = { dashboardSite: { findMany: vi.fn(async () => existing), update, create, updateMany } };
  return { tx: tx as unknown as Prisma.TransactionClient, update, create, updateMany };
}

const site = (name: string): SiteInput => ({ name, sortOrder: 0, stages: [] });

describe("upsertSites — website-created sites are protected from the sheet sync", () => {
  const web: Row = { id: "w1", name: "Tulsi Pune", origin: "WEBSITE", isActive: true, lastSeenRunId: null };
  const sheet: Row = { id: "s1", name: "Tulsi Indore", origin: "SHEET", isActive: true, lastSeenRunId: "old-run" };

  it("skips a sheet site whose normalised name matches a website site (no update, no create, reported)", async () => {
    const { tx, update, create } = fakeTx([web]);
    const result = await upsertSites(tx, "run-1", [site("  tulsi   PUNE ")]);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result.skippedWebsiteSites).toEqual(["Tulsi Pune"]);
    expect(result.byNormName.size).toBe(0); // so replaceSiteSteps never runs for it
  });

  it("never archives a website site that is absent from the run, but still archives absent sheet sites", async () => {
    const { tx, updateMany } = fakeTx([web, sheet]);
    const result = await upsertSites(tx, "run-2", []);
    expect(result.archivedCount).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ["s1"] } }, data: { isActive: false } });
  });

  it("still updates a matching sheet site and creates a new one as before", async () => {
    const { tx, update, create } = fakeTx([sheet]);
    const result = await upsertSites(tx, "run-3", [site("Tulsi Indore"), site("Brand New")]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.skippedWebsiteSites).toEqual([]);
    expect(result.byNormName.size).toBe(2);
  });
});
