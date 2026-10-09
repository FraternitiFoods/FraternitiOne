/**
 * plan.md section 24 (delay tracking, proposed 2026-10-08), S1: "Export a CSV
 * of all task templates (stage, category, title, module, slaDays blank) for
 * me and the ops heads to fill in." Read-only — never touches the DB, only
 * reads the two template files that already drive seeding
 * (src/lib/lifecycle-stage-tasks.ts, src/lib/ops-progress-tasks.ts).
 *
 * The `slaDays` column is always left blank here: SLA numbers come from
 * Apoorv and the ops heads, never invented in code (plan.md's explicit
 * rule). Once the filled-in CSV comes back, its values get folded into
 * src/lib/task-sla-defaults.ts by hand, and scripts/backfill-task-sla.ts
 * applies them to existing projects.
 *
 * Usage: npx tsx scripts/export-task-sla-template.ts
 *        (writes task-sla-template.csv in the repo root)
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { LIFECYCLE_STAGE_ORDER } from "../src/lib/format";
import { STAGE_DEFAULT_DEPARTMENT, STAGE_TASK_TEMPLATES } from "../src/lib/lifecycle-stage-tasks";
import { OPS_PROGRESS_TASK_TEMPLATES } from "../src/lib/ops-progress-tasks";

type Row = { stage: string; category: string; title: string; module: string };

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvLine(fields: string[]): string {
  return fields.map(csvField).join(",");
}

function main() {
  const rows: Row[] = [];

  for (const stage of LIFECYCLE_STAGE_ORDER) {
    for (const title of STAGE_TASK_TEMPLATES[stage]) {
      rows.push({ stage, category: "", title, module: STAGE_DEFAULT_DEPARTMENT[stage] });
    }
  }
  for (const item of OPS_PROGRESS_TASK_TEMPLATES) {
    rows.push({ stage: item.lifecycleStage, category: item.category, title: item.title, module: item.module });
  }

  const lines = [
    toCsvLine(["stage", "category", "title", "module", "slaDays"]),
    ...rows.map((r) => toCsvLine([r.stage, r.category, r.title, r.module, ""])),
  ];

  const outPath = join(process.cwd(), "task-sla-template.csv");
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${rows.length} rows to ${outPath}`);
}

main();
