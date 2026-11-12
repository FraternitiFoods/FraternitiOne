import type { Prisma } from "@prisma/client";
import { OPS_BOQ_FIXED_ROWS } from "./ops-boq-seed";

/** Anything with `.opsBoqRow` — the shared db client or a `$transaction` client. */
type OpsBoqWriter = Pick<Prisma.TransactionClient, "opsBoqRow">;

/**
 * Creates the 11 fixed rows for a site (operations-boq-handoff.md sections 4/6).
 * Idempotent and race-safe: `skipDuplicates` leans on the
 * @@unique([siteId, fixedKey]) index, so a second call (or two concurrent
 * ones) never duplicates a row and never overwrites one a user has since edited
 * or renamed. Returns how many rows were actually created (0 on a re-run).
 *
 * Call it with the `tx` of the transaction that creates the Site so the site
 * and its rows commit or fail together. Deliberately free of "server-only" and
 * of the app's db singleton (it takes the client as a parameter) so the e2e
 * script can exercise the real function.
 */
export async function ensureOpsBoqRows(client: OpsBoqWriter, siteId: string): Promise<number> {
  const result = await client.opsBoqRow.createMany({
    data: OPS_BOQ_FIXED_ROWS.map((row, index) => ({
      siteId,
      fixedKey: row.fixedKey,
      isFixed: true,
      sno: row.sno,
      name: row.name,
      vendor: row.vendor,
      sortOrder: index,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
