import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Pushes scripts/fixtures/dashboard-sync-fixture.json through the live
 * /api/dashboard-sync/* API the same way the real Apps Script sync will:
 * start -> chunk (one per site) -> finish.
 *
 * Requires a running `pnpm dev` and DASHBOARD_SYNC_SECRET set in .env.
 * Usage: npx tsx scripts/push-dashboard-sync-fixture.ts
 */

const BASE = "http://localhost:3000";
const SECRET = process.env.DASHBOARD_SYNC_SECRET;
if (!SECRET) {
  console.error("DASHBOARD_SYNC_SECRET is not set. Add it to .env before running this script.");
  process.exit(1);
}

type Fixture = {
  sites: { name: string }[];
  deptLinks: unknown[];
};

async function callApi(pathSuffix: string, body: unknown): Promise<{ status: number; ok: boolean; json: unknown }> {
  const res = await fetch(`${BASE}${pathSuffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

function expectOk(label: string, result: { status: number; ok: boolean; json: unknown }) {
  if (!result.ok) {
    throw new Error(`${label} failed (${result.status}): ${JSON.stringify(result.json)}`);
  }
  return result.json;
}

async function pushFixture(fixture: Fixture) {
  const start = expectOk(
    "start",
    await callApi("/api/dashboard-sync/start", {
      requestId: null,
      trigger: "button",
      sheetName: "Site Drawing Updates (fixture)",
      sheetId: "fixture-sheet-id",
      siteCount: fixture.sites.length,
      deptLinks: fixture.deptLinks,
    })
  );
  const runId = (start as { runId: string }).runId;
  console.log(`\nStarted run ${runId}`);

  for (const site of fixture.sites) {
    const result = expectOk(`chunk site "${site.name}"`, await callApi("/api/dashboard-sync/chunk", { runId, site }));
    console.log(`site "${site.name}" warnings:`, (result as { warnings: string[] }).warnings);
  }

  const summary = expectOk(
    "finish",
    await callApi("/api/dashboard-sync/finish", { runId, expected: { sites: fixture.sites.length } })
  );
  return summary;
}

async function main() {
  const fixturePath = path.join(process.cwd(), "scripts/fixtures/dashboard-sync-fixture.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as Fixture;

  const summary = await pushFixture(fixture);
  console.log("\nFinished run summary:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
