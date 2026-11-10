import "server-only";

import rawTemplate from "../../prisma/seed-data/dashboard-steps.json";

/**
 * The per-site step template (the "402 tasks") used when an admin creates a
 * Dashboard site on the website. There is no template table: the source of
 * truth is the committed file prisma/seed-data/dashboard-steps.json, a flat
 * list of tasks per stage (`{ stages: [{ stage: "1 - Name", tasks: [...] }] }`),
 * so it is reviewable and editable in git. Only structure lives here —
 * status/remark/shared/deliverables are per-site and start blank, assignedTo
 * is set by the create action.
 */
export type TemplateStep = {
  stageNo: number;
  stageName: string;
  stepKey: string;
  parentKey: string | null;
  label: string;
  sortOrder: number;
  isParent: boolean;
};

export type RawTemplate = { stages: { stage: string; tasks: string[] }[] };

export type TemplateSummary = { leaves: number; parents: number; stages: number };

const STAGE_PATTERN = /^\s*(\d+)\s*-\s*(.+?)\s*$/;

/**
 * Flattens the raw file into step rows. The file has no sub-step hierarchy,
 * so every task is a leaf; stepKey is its 1-based position within the stage
 * (stable as long as tasks are only appended — reordering the file would
 * change keys, which only matters for sites created afterwards).
 */
export function buildTemplate(raw: RawTemplate): TemplateStep[] {
  return raw.stages.flatMap((stage) => {
    const match = STAGE_PATTERN.exec(stage.stage);
    if (!match) throw new Error(`Dashboard step template: stage "${stage.stage}" must look like "7 - Construction Execution".`);
    const stageNo = Number(match[1]);
    const stageName = match[2];
    return stage.tasks.map((label, i) => ({
      stageNo,
      stageName,
      stepKey: String(i + 1),
      parentKey: null,
      label: label.trim(),
      sortOrder: i + 1,
      isParent: false,
    }));
  });
}

/** Throws on a structurally broken template; returns counts so callers/tests can assert the expected shape. */
export function validateTemplate(steps: readonly TemplateStep[]): TemplateSummary {
  if (steps.length === 0) {
    throw new Error("Dashboard step template is empty. Fill prisma/seed-data/dashboard-steps.json.");
  }

  const keys = new Set<string>();
  const stages = new Set<number>();
  let leaves = 0;
  let parents = 0;

  for (const step of steps) {
    if (!step.label) throw new Error(`Dashboard step template has an empty task in stage ${step.stageNo}.`);
    const id = `${step.stageNo}:${step.stepKey}`;
    if (keys.has(id)) throw new Error(`Dashboard step template has a duplicate step ${id}.`);
    keys.add(id);
    stages.add(step.stageNo);
    if (step.isParent) parents++;
    else leaves++;
  }

  for (const step of steps) {
    if (step.parentKey !== null && !keys.has(`${step.stageNo}:${step.parentKey}`)) {
      throw new Error(`Dashboard step template step ${step.stageNo}:${step.stepKey} points at missing parent "${step.parentKey}".`);
    }
  }

  if (leaves === 0) throw new Error("Dashboard step template has no leaf steps.");
  return { leaves, parents, stages: stages.size };
}

let validated: readonly TemplateStep[] | null = null;

/** Parsed + validated once per server process (module scope) — creating a site never re-validates 402 rows. */
export function getDashboardStepTemplate(): readonly TemplateStep[] {
  if (validated) return validated;
  const steps = buildTemplate(rawTemplate as RawTemplate);
  validateTemplate(steps);
  validated = steps;
  return steps;
}
