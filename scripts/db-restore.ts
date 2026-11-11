import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  diffAgainstSnapshot,
  dropSnapshot,
  getSnapshotInfo,
  isClean,
  keyCounts,
  restoreFromSnapshot,
  takeSnapshot,
  type TableDiff,
} from "./lib/db-restore";

/**
 * Snapshot / restore for the database in `.env` (the Neon preview branch) around
 * scripts that push a fixture through a full-snapshot import. Those imports
 * deactivate every real item/site/dashboard site that is not in the fixture
 * (plan.md Progress log 2026-11-10). CLAUDE.md, "Test data and the `.env`
 * database", rule 3 says: snapshot first, restore after, prove it. This does it.
 *
 *   E2E_ALLOW_FIXTURE_PUSH=1 npx tsx scripts/db-restore.ts run scripts/tmp-e2e-m6-purchase-orders.ts
 *       snapshot -> run the script (needs `pnpm dev` running, as before) -> restore
 *       (even if the script fails) -> print what was undone and the key counts.
 *       Exit code: the script's, or 2 if the restore itself failed.
 *   E2E_ALLOW_FIXTURE_PUSH=1 npx tsx scripts/db-restore.ts snapshot   take a snapshot only
 *   npx tsx scripts/db-restore.ts diff      what differs from the snapshot now (read-only)
 *   npx tsx scripts/db-restore.ts restore   put the data back and remove the snapshot
 *                                           (recovery after a crashed run; no opt-in needed)
 *   npx tsx scripts/db-restore.ts drop      discard the snapshot WITHOUT restoring
 *
 * `run` and `snapshot` need the same per-command opt-in as the fixture scripts
 * (scripts/lib/require-fixture-opt-in.ts); recovery commands do not, because
 * they only do anything if a snapshot was taken first. The snapshot lives in the
 * same database (schema `e2e_snapshot`), so a closed terminal loses nothing.
 * Scope and limits: scripts/lib/db-restore.ts.
 */

const db = new PrismaClient();
const [command, ...rest] = process.argv.slice(2);

function describeDiffs(diffs: TableDiff[]): string {
  const dirty = diffs.filter((d) => d.changed + d.added + d.removed > 0);
  if (dirty.length === 0) return "  (no differences from the snapshot)";
  return dirty
    .map((d) => `  ${d.table.padEnd(20)} changed ${String(d.changed).padStart(5)}   new-in-live ${String(d.added).padStart(5)}   missing-in-live ${String(d.removed).padStart(5)}`)
    .join("\n");
}

async function restoreAndReport(): Promise<void> {
  const undone = await restoreFromSnapshot(db);
  console.log("\n[db-restore] Restored. What had to be undone:\n" + describeDiffs(undone));
  console.log("[db-restore] Snapshot removed. Key counts now:", JSON.stringify(await keyCounts(db)));
}

function runChild(script: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    // Ctrl-C reaches the child too (same console); keep THIS process alive so the restore below still runs.
    const ignore = () => {};
    process.on("SIGINT", ignore);
    const child = spawn(process.execPath, ["--import", "tsx", script, ...args], { stdio: "inherit", env: process.env });
    child.on("error", (e) => {
      console.error("[db-restore] could not start the script:", e.message);
      process.off("SIGINT", ignore);
      resolve(1);
    });
    child.on("close", (code, signal) => {
      process.off("SIGINT", ignore);
      resolve(code ?? (signal ? 130 : 1));
    });
  });
}

async function main(): Promise<number> {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://unset").host;
  console.log(`[db-restore] database host: ${host}`);

  switch (command) {
    case "run": {
      const [script, ...args] = rest;
      if (!script) throw new Error("Usage: db-restore.ts run <scripts/some-script.ts> [args...]");
      const scriptPath = path.resolve(script);
      if (!fs.existsSync(scriptPath)) throw new Error(`Script not found: ${scriptPath}`);
      if (path.resolve(scriptPath) === path.resolve(__filename)) throw new Error("Refusing to run db-restore.ts through itself.");
      await import("./lib/require-fixture-opt-in"); // exits 1 without E2E_ALLOW_FIXTURE_PUSH=1 or on a forbidden host

      console.log("[db-restore] key counts before:", JSON.stringify(await keyCounts(db)));
      await takeSnapshot(db);
      console.log("[db-restore] snapshot taken; running", path.relative(process.cwd(), scriptPath), "\n");
      let code = await runChild(scriptPath, args);
      console.log(`\n[db-restore] script exited with code ${code}; restoring...`);
      try {
        await restoreAndReport();
      } catch (e) {
        console.error("[db-restore] RESTORE FAILED — the snapshot is still in the database. Fix the cause, then run: npx tsx scripts/db-restore.ts restore\n", e);
        code = 2;
      }
      return code;
    }
    case "snapshot": {
      await import("./lib/require-fixture-opt-in");
      await takeSnapshot(db);
      console.log("[db-restore] snapshot taken. Key counts:", JSON.stringify(await keyCounts(db)));
      console.log("[db-restore] when done: npx tsx scripts/db-restore.ts restore");
      return 0;
    }
    case "diff": {
      const info = await getSnapshotInfo(db);
      if (!info) {
        console.log("[db-restore] no snapshot exists.");
        return 0;
      }
      const diffs = await diffAgainstSnapshot(db);
      console.log(`[db-restore] snapshot taken ${info.takenAt.toISOString()}. Live vs snapshot:\n` + describeDiffs(diffs));
      return isClean(diffs) ? 0 : 1;
    }
    case "restore": {
      await restoreAndReport();
      return 0;
    }
    case "drop": {
      await dropSnapshot(db);
      console.log("[db-restore] snapshot dropped (live data NOT touched).");
      return 0;
    }
    default:
      console.error("Usage: db-restore.ts <run <script> [args...] | snapshot | diff | restore | drop>");
      return 1;
  }
}

main()
  .then((code) => db.$disconnect().finally(() => process.exit(code)))
  .catch(async (e) => {
    console.error("[db-restore] ERROR:", e instanceof Error ? e.message : e);
    await db.$disconnect().catch(() => {});
    process.exit(1);
  });
