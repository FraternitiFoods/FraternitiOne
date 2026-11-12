import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";

/**
 * Throwaway ADMIN user for e2e scripts, so they never depend on the real
 * `tech@fraterniti.co.in` password. That password is rotated in real databases
 * (and preview/test Neon branches are copies of them), so logging in with
 * `SEED_DEV_PASSWORD` fails there and the script times out at the login step
 * (found 2026-11-10, plan.md Progress log). Same pattern as
 * tmp-e2e-nav-reliability.ts and the dashboard e2e scripts.
 *
 * Usage: create at the start of main(), log in with THROWAWAY_ADMIN_PASSWORD,
 * delete in `finally`. Each script uses its own email so concurrent/leftover
 * runs of different scripts can't clash.
 */
export const THROWAWAY_ADMIN_PASSWORD = "TmpE2eAdmin123!";

export async function createThrowawayAdmin(db: PrismaClient, email: string): Promise<void> {
  await deleteThrowawayAdmin(db, email); // idempotent: clear a leftover from a crashed earlier run
  const passwordHash = await bcrypt.hash(THROWAWAY_ADMIN_PASSWORD, 12);
  await db.user.create({ data: { name: "Tmp E2E Admin", email, role: "ADMIN", passwordHash } });
}

/**
 * Removes the user and what would block or outlive it: purchase orders it
 * created (FK is `Restrict`, lines cascade) and its audit rows (actorEmail is
 * a denormalized copy that survives the user, so it would otherwise linger).
 */
export async function deleteThrowawayAdmin(db: PrismaClient, email: string): Promise<void> {
  await db.purchaseOrder.deleteMany({ where: { createdBy: { email } } });
  await db.auditEvent.deleteMany({ where: { actorEmail: email } });
  await db.user.deleteMany({ where: { email } });
}
