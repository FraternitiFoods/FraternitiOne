/**
 * plan.md section 17 / step 0 finding: FranchiseProject.id is a plain cuid()
 * string, not the "FR-00001" human code (that's a separate seq+format, see
 * src/lib/format.ts's formatProjectCode). So reserving a Project ID on day
 * one just means minting a unique string now and inserting it explicitly as
 * FranchiseProject.id later (at conversion) — it does not need to replicate
 * Prisma's own cuid algorithm.
 */
import { randomUUID } from "node:crypto";

export function generateReservedProjectId(): string {
  return randomUUID();
}

/** "F1-0001" style human code from StoreOnboarding.seq — same pattern as formatProjectCode. */
export function formatOnboardingCode(seq: number): string {
  return `F1-${String(seq).padStart(4, "0")}`;
}
