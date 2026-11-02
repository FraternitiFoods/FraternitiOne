import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Pushes a small fixture through `POST /api/import/tracker`
 * (site-tracker-plan.md section 7, Phase 2 — milestone T6, optional) the
 * same way Abhishek's future Apps Script push would. Requires a running
 * `pnpm dev`, `IMPORT_SECRET` set in .env, and `npm run seed:tracker` to
 * have run at least once (uses "Tulsi Jabalpur" and 2 of its steps by
 * code, resetting just those rows before/after so it's safe to re-run).
 *
 * Covers: wrong secret -> 401; unknown site/step -> warnings, not failures;
 * imported Completed -> legacyCompleted (no evidence needed); a row a real
 * user has already edited on the website is left alone unless
 * `overwrite: true`.
 *
 * Usage: npx tsx scripts/push-tracker-fixture.ts
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const SECRET = process.env.IMPORT_SECRET!;
if (!SECRET) throw new Error("IMPORT_SECRET not set");

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

async function post(body: unknown, secret = SECRET) {
  const res = await fetch(`${BASE}/api/import/tracker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const site = await db.site.findFirst({ where: { usedInTracker: true, name: "Tulsi Jabalpur" } });
  const step1 = await db.trackerStep.findUnique({ where: { code: "7.1.6" } });
  const step2 = await db.trackerStep.findUnique({ where: { code: "7.1.7" } });
  if (!site || !step1 || !step2) throw new Error("Fixture site/steps not found — run `npm run seed:tracker` first.");

  await db.trackerSiteStep.deleteMany({ where: { siteId: site.id, stepId: { in: [step1.id, step2.id] } } });

  const wrongSecret = await post({ rows: [{ siteName: site.name, stepCode: step1.code, status: "Completed" }] }, "wrong-secret");
  check("wrong secret -> 401", wrongSecret.status === 401);

  const basic = await post({
    rows: [
      { siteName: site.name, stepCode: step1.code, status: "Completed", assignee: "Ramesh" },
      { siteName: "Nonexistent Site", stepCode: step2.code, status: "In Progress" },
      { siteName: site.name, stepCode: "9.9.9", status: "In Progress" },
    ],
  });
  check("basic push -> 200", basic.status === 200);
  check("1 processed, 2 unknown", basic.body.counts.processed === 1 && basic.body.counts.skippedUnknown === 2);
  check("2 warnings (unknown site, unknown step)", basic.body.warnings.length === 2);

  const row1 = await db.trackerSiteStep.findUnique({ where: { siteId_stepId: { siteId: site.id, stepId: step1.id } } });
  check("imported Completed -> legacyCompleted true", row1?.status === "COMPLETED" && row1?.legacyCompleted === true);
  check(
    "imported Completed has 0 evidence and is still valid",
    (await db.trackerEvidence.count({ where: { siteStepId: row1!.id } })) === 0
  );

  // Simulate a real website edit (sets updatedById), then re-push without overwrite — should be skipped.
  const anyUser = await db.user.findFirst();
  await db.trackerSiteStep.update({ where: { id: row1!.id }, data: { updatedById: anyUser!.id } });

  const noOverwrite = await post({ rows: [{ siteName: site.name, stepCode: step1.code, status: "In Progress" }] });
  check("re-push without overwrite is skipped (counts)", noOverwrite.body.counts.skippedAlreadyEdited === 1);
  const afterNoOverwrite = await db.trackerSiteStep.findUnique({ where: { id: row1!.id } });
  check("status unchanged without overwrite", afterNoOverwrite?.status === "COMPLETED");

  const withOverwrite = await post({ rows: [{ siteName: site.name, stepCode: step1.code, status: "In Progress" }], overwrite: true });
  check("re-push with overwrite:true processes it", withOverwrite.body.counts.processed === 1);
  const afterOverwrite = await db.trackerSiteStep.findUnique({ where: { id: row1!.id } });
  check("status changed with overwrite:true", afterOverwrite?.status === "IN_PROGRESS");

  await db.trackerSiteStep.deleteMany({ where: { siteId: site.id, stepId: { in: [step1.id, step2.id] } } });

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
