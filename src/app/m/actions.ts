"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { deleteSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";

/**
 * Same shape as the desktop logout() (src/app/(auth)/login/actions.ts), kept
 * separate only because the redirect target differs — a supervisor signing
 * out belongs back at /m/login, not the desktop /login.
 */
export async function logoutSupervisor(): Promise<void> {
  const user = await requireUser();

  await writeAuditEvent(db, {
    actor: user,
    entityType: "User",
    entityId: user.id,
    action: "LOGOUT",
    source: "mobile",
  });

  await deleteSession();
  redirect("/m/login");
}
