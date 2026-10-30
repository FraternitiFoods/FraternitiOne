import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Pushes scripts/fixtures/boq-import-fixture.json through the live import
 * API (plan.md section 7) the same way Abhishek's Apps Script will: begin ->
 * chunk(sites) -> chunk(vendors) -> chunk(category) per category -> finish.
 *
 * Requires a running `pnpm dev` and IMPORT_SECRET set in .env.
 * Usage: npx tsx scripts/push-boq-fixture.ts
 */

const BASE = "http://localhost:3000";
const IMPORT_SECRET = process.env.IMPORT_SECRET;
if (!IMPORT_SECRET) {
  console.error("IMPORT_SECRET is not set. Add it to .env before running this script.");
  process.exit(1);
}

type Fixture = {
  sites: unknown[];
  vendors: unknown[];
  categories: { category: string }[];
};

async function callApi(
  pathSuffix: string,
  body: unknown,
  secret: string = IMPORT_SECRET!
): Promise<{ status: number; ok: boolean; json: unknown }> {
  const res = await fetch(`${BASE}${pathSuffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
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
  const begin = expectOk("begin", await callApi("/api/import/boq/begin", { dryRun: false }));
  const runId = (begin as { runId: string }).runId;
  console.log(`\nStarted run ${runId}`);

  const sites = expectOk("chunk sites", await callApi("/api/import/boq/chunk", { runId, type: "sites", data: fixture.sites }));
  console.log("sites warnings:", (sites as { warnings: string[] }).warnings);

  const vendors = expectOk(
    "chunk vendors",
    await callApi("/api/import/boq/chunk", { runId, type: "vendors", data: fixture.vendors })
  );
  console.log("vendors warnings:", (vendors as { warnings: string[] }).warnings);

  for (const category of fixture.categories) {
    const result = expectOk(
      `chunk category ${category.category}`,
      await callApi("/api/import/boq/chunk", { runId, type: "category", data: category })
    );
    console.log(`category "${category.category}" warnings:`, (result as { warnings: string[] }).warnings);
  }

  const summary = expectOk("finish", await callApi("/api/import/boq/finish", { runId }));
  return summary;
}

async function main() {
  const fixturePath = path.join(process.cwd(), "scripts/fixtures/boq-import-fixture.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as Fixture;

  const summary = await pushFixture(fixture);
  console.log("\nFinished run summary:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
