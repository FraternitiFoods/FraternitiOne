import { z } from "zod";

/**
 * Pure rules for Admin's "Team" page (plan.md section 12): which tasks a person
 * is assigned on a website-created Dashboard site. No DB and no "server-only",
 * so the client picker and vitest can import it.
 */

/** A template site has ~466 leaf tasks; this is a generous ceiling against a forged giant payload. */
export const MAX_ASSIGNED_STEPS = 1000;

export const setUserSiteAssignmentsSchema = z.object({
  siteId: z.string().min(1, "Invalid request."),
  userId: z.string().min(1, "Invalid request."),
  stepIds: z
    .array(z.string().min(1))
    .max(MAX_ASSIGNED_STEPS, "Too many tasks selected.")
    // Duplicates would only collapse into one row anyway; normalising here keeps the "all ids belong to the site" count check exact.
    .transform((ids) => [...new Set(ids)]),
});

/** What to write so that the person's assignments on a site become exactly `next` (set semantics, order-independent). */
export function diffAssignments(
  current: Iterable<string>,
  next: Iterable<string>
): { toAdd: string[]; toRemove: string[] } {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    toAdd: [...nextSet].filter((id) => !currentSet.has(id)),
    toRemove: [...currentSet].filter((id) => !nextSet.has(id)),
  };
}

/** `{ "1": 12, "8": 40 }` — task count per stage, what the audit log records instead of hundreds of ids. */
export function countByStage(steps: { stageNo: number }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of steps) {
    const key = String(s.stageNo);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
