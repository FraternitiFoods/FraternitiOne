/**
 * Idempotent Site Tracker seed (site-tracker-plan.md milestone T1). Separate
 * command from `db:seed` on purpose (site-tracker-plan.md: "do not mix with
 * the dev seed split") — this only touches TrackerSection/TrackerStep plus
 * Site.usedInTracker, never Site BOQ data.
 *
 * Reads prisma/seed-data/site-tracker-steps.json and:
 *   - Upserts TrackerSection by name, TrackerStep by code (the sheet's own
 *     non-contiguous codes — never renumbered).
 *   - For each tracker site: if `linkBoqNames` matches an existing Site
 *     (case-insensitive, exact), reuses that Site and sets
 *     usedInTracker = true; otherwise upserts a new Site by the tracker's
 *     own exact name (usedInBoq = false, usedInTracker = true). "Pavitra"
 *     and "Pavitra Vadodara" have no linkBoqNames in the seed data, so they
 *     are never guessed into the same Site.
 *
 * Safe to run twice: same section/step/site counts, no duplicate rows.
 * Run with: npm run seed:tracker
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();

type StepJson = { code: string; name: string; synthetic?: boolean };
type SectionJson = { name: string; steps: StepJson[] };
type SiteJson = { name: string; linkBoqNames?: string[] };
type SeedFile = { sections: SectionJson[]; sites: SiteJson[] };

function loadSeedFile(): SeedFile {
  const filePath = path.join(process.cwd(), "prisma/seed-data/site-tracker-steps.json");
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as SeedFile;
}

async function seedSections(sections: SectionJson[]) {
  let stepCount = 0;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const sectionRow = await db.trackerSection.upsert({
      where: { name: section.name },
      update: { order: i + 1 },
      create: { name: section.name, order: i + 1 },
    });

    for (let j = 0; j < section.steps.length; j++) {
      const step = section.steps[j];
      await db.trackerStep.upsert({
        where: { code: step.code },
        update: {
          name: step.name,
          sectionId: sectionRow.id,
          order: j + 1,
          synthetic: step.synthetic ?? false,
        },
        create: {
          code: step.code,
          name: step.name,
          sectionId: sectionRow.id,
          order: j + 1,
          synthetic: step.synthetic ?? false,
        },
      });
      stepCount += 1;
    }
  }
  return { sectionCount: sections.length, stepCount };
}

async function seedSites(sites: SiteJson[]) {
  const linked: { trackerName: string; boqName: string }[] = [];
  const own: string[] = [];

  for (const site of sites) {
    let target: { id: string; name: string } | null = null;

    // Case-insensitive, exact match only — never fuzzy — so two distinct
    // sites (e.g. "Pavitra" / "Pavitra Vadodara") can't accidentally merge.
    if (site.linkBoqNames?.length) {
      for (const candidate of site.linkBoqNames) {
        target = await db.site.findFirst({
          where: { name: { equals: candidate, mode: "insensitive" } },
        });
        if (target) break;
      }
    }

    if (target) {
      await db.site.update({ where: { id: target.id }, data: { usedInTracker: true } });
      linked.push({ trackerName: site.name, boqName: target.name });
      continue;
    }

    // No linkBoqNames match — upsert by the tracker's own exact name so a
    // second run of this seed reuses the same row instead of colliding with
    // Site.name's unique constraint.
    const createdOrReused = await db.site.upsert({
      where: { name: site.name },
      update: { usedInTracker: true },
      create: {
        sourceKey: `TRACKER-${randomUUID()}`,
        name: site.name,
        usedInBoq: false,
        usedInTracker: true,
      },
    });
    own.push(createdOrReused.name);
  }

  return { linked, own };
}

async function main() {
  const seedFile = loadSeedFile();

  const { sectionCount, stepCount } = await seedSections(seedFile.sections);
  console.log(`Seeded ${sectionCount} sections, ${stepCount} steps.`);

  const { linked, own } = await seedSites(seedFile.sites);

  console.log(`\nLinked to an existing Site BOQ site (${linked.length}):`);
  for (const l of linked) console.log(`  - "${l.trackerName}" -> existing Site "${l.boqName}"`);

  console.log(`\nTracker-only sites, not linked to any BOQ site (${own.length}):`);
  for (const name of own) console.log(`  - ${name}`);

  console.log(`\nTotal tracker sites: ${linked.length + own.length}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
