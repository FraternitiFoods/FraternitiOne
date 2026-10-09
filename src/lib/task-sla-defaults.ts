/**
 * plan.md section 24 (delay tracking, proposed 2026-10-08): "Numbers live in
 * these files so they can be changed in one place. Claude Code must not
 * invent SLA numbers." This map starts empty on purpose — it is the one file
 * Apoorv/the ops heads edit once `scripts/export-task-sla-template.ts`'s CSV
 * comes back filled in. `createProjectWithSeedTasks` (src/lib/project-seed.ts)
 * and `scripts/backfill-task-sla.ts` both read from here; neither invents a
 * number of its own.
 *
 * Keyed by normalized title only (not title+category) because
 * STAGE_TASK_TEMPLATES has no category of its own — see normalizeTaskTitle.
 */
export const TASK_SLA_DEFAULTS: Record<string, number> = {};

/**
 * Same whitespace-normalization idea as scripts/backfill-ops-tasks.ts's
 * local `key()` helper, scoped to title only. Kept separate from that
 * script's version (which also folds in `category`, for a different
 * matching purpose) rather than sharing one function across two unrelated
 * concerns.
 */
export function normalizeTaskTitle(title: string): string {
  return title.replace(/[\n\t]/g, " ").replace(/\s+/g, " ").trim();
}
