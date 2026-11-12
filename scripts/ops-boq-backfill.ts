import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { ensureOpsBoqRows } from "../src/lib/ops-boq-ensure";

/**
 * One-off: create the 11 fixed Operations BOQ rows for sites that existed
 * before the module did (operations-boq-handoff.md section 6: "offer to run
 * ensureOpsBoqRows for them as a one-off — do not silently backfill").
 *
 *   npx tsx scripts/ops-boq-backfill.ts                       dry run: lists what WOULD be created
 *   OPS_BOQ_BACKFILL=1 npx tsx scripts/ops-boq-backfill.ts --apply
 *
 * Scope: active Site BOQ sites (isActive && usedInBoq — the same set the
 * Operations BOQ site picker offers) that have NO Operations BOQ rows yet.
 * Idempotent (ensureOpsBoqRows skips existing rows), one transaction per site.
 * Uses whatever DATABASE_URL is in the environment — check the host it prints
 * before applying, and never point it at production without the owner's OK.
 */
const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && process.env.OPS_BOQ_BACKFILL !== "1") {
    throw new Error("Refusing to write: set OPS_BOQ_BACKFILL=1 together with --apply.");
  }
  console.log(`Database host: ${new URL(process.env.DATABASE_URL!).host}`);

  const sites = await db.site.findMany({
    where: { isActive: true, usedInBoq: true, opsBoqRows: { none: {} } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  console.log(`${sites.length} active Site BOQ site(s) without Operations BOQ rows:`);
  for (const s of sites) console.log(` - ${s.name}`);

  if (!apply) {
    console.log("\nDry run: nothing written. Re-run with OPS_BOQ_BACKFILL=1 and --apply to create their rows.");
    return;
  }
  let created = 0;
  for (const s of sites) {
    created += await db.$transaction((tx) => ensureOpsBoqRows(tx, s.id));
  }
  console.log(`\nCreated ${created} row(s) for ${sites.length} site(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
