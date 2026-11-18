import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { upsertSites } from "./commit";
import type { SiteStartInput } from "./schema";
import type { ResolvedSite } from "@/lib/site-resolve";

type Row = {
  id: string;
  name: string;
  sourceKey: string;
  note: string | null;
  sortOrder: number;
  isLocked: boolean;
  usedInBoq: boolean;
  lastSeenRunId: string | null;
};

const row = (over: Partial<Row> & { id: string; name: string; sourceKey: string }): Row => ({
  note: null,
  sortOrder: 0,
  isLocked: false,
  usedInBoq: true,
  lastSeenRunId: "old-run",
  ...over,
});

/** Minimal fake of the tx client: only what upsertSites touches. */
function fakeTx(existing: Row[]) {
  const update = vi.fn(async () => ({}));
  const create = vi.fn(async ({ data }: { data: { name: string } }) => ({ id: "new-id", name: data.name }));
  const updateMany = vi.fn(async () => ({}));
  const tx = { site: { findMany: vi.fn(async () => existing), update, create, updateMany } };
  return { tx: tx as unknown as Prisma.TransactionClient, update, create, updateMany };
}

const input = (name: string): SiteStartInput => ({ position: 1, name });

const sheetSite = row({ id: "s1", name: "Tulsi Hissar", sourceKey: "SHEET-1" });
const webSite = row({ id: "w1", name: "Tulsi Pune", sourceKey: "WEB-1" });

describe("sheet-sync upsertSites — scoped to sheet-origin sites", () => {
  it("never adopts a website-created (WEB-) site with the same name: no update, no create, warned, left out of the result", async () => {
    const { tx, update, create } = fakeTx([webSite]);
    const warnings: string[] = [];
    const result = await upsertSites(tx, "run-1", [input("  tulsi   PUNE ")], [], warnings);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result.byNormName.size).toBe(0); // so none of its SiteItems are touched
    expect(warnings.join(" ")).toContain("created on the website");
  });

  it("never archives a website site that is absent from the sheet, but still archives an absent sheet site", async () => {
    const { tx, updateMany } = fakeTx([webSite, sheetSite]);
    const result = await upsertSites(tx, "run-2", [], [], []);
    expect(result.archivedCount).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ["s1"] } }, data: { usedInBoq: false } });
  });

  it("a sheet spelling matched through an alias updates the real site and keeps its name", async () => {
    const { tx, update, create } = fakeTx([sheetSite]);
    const resolved = new Map<string, ResolvedSite>([
      ["tulsi hisar", { id: "s1", name: "Tulsi Hissar", websiteOwned: false, created: false }],
    ]);
    const result = await upsertSites(tx, "run-3", [input("Tulsi Hisar")], [], [], resolved);
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const data = (update.mock.calls[0] as unknown as [{ data: { name: string } }])[0].data;
    expect(data.name).toBe("Tulsi Hissar");
    expect(result.byNormName.get("tulsi hisar")?.id).toBe("s1");
  });

  it("an exact-name match is updated (and may be re-spelled) as before; an unknown name is created and reported", async () => {
    const { tx, update, create } = fakeTx([sheetSite]);
    const result = await upsertSites(tx, "run-4", [input("tulsi hissar"), input("Brand New")], [], []);
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.createdNames).toEqual(["Brand New"]);
  });
});
