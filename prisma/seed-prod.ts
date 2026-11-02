/**
 * Production seed — only what the app needs to start (plan.md milestone M1;
 * site-tracker-plan.md milestone T1): the 21 categories, app_settings
 * defaults, and (if this branch's seed data is present) Site Tracker
 * sections/steps/sites. No fixtures, no demo/dev users — see prisma/seed.ts
 * for that, which this script never calls and which refuses to run in
 * production itself.
 *
 * Every write here is an upsert that never overwrites a row a real import or
 * an Admin may have already touched, so running this twice (or against a
 * database that already has real data) is always safe.
 *
 * Run with: npm run seed:prod
 */
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import path from "node:path";
import { seedCategories, seedAppSettings } from "./seed-shared";
import { loadTrackerSeedFile, seedTrackerSections, seedTrackerSites } from "./seed-tracker";

const db = new PrismaClient();

async function main() {
  const categoryCount = await seedCategories(db);
  console.log(`Seeded ${categoryCount} categories.`);

  const mode = await seedAppSettings(db);
  console.log(`Seeded app_settings (mode = ${mode}).`);

  const trackerSeedPath = path.join(process.cwd(), "prisma/seed-data/site-tracker-steps.json");
  if (!existsSync(trackerSeedPath)) {
    console.log("No prisma/seed-data/site-tracker-steps.json found — skipping Site Tracker seed.");
    return;
  }

  const seedFile = loadTrackerSeedFile();
  const { sectionCount, stepCount } = await seedTrackerSections(db, seedFile.sections);
  console.log(`Seeded ${sectionCount} tracker sections, ${stepCount} tracker steps.`);

  const { linked, own } = await seedTrackerSites(db, seedFile.sites);
  console.log(
    `Seeded ${linked.length + own.length} tracker sites (${linked.length} linked to existing Site BOQ sites, ${own.length} tracker-only).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
