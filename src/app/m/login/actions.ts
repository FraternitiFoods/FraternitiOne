"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { verifyPin } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";

// plan.md section 16, PIN rules item 3 (resolved 2026-09-24): 5 wrong PINs
// in a row locks that phone number out for 15 minutes. Reset to 0/null on a
// correct login or by the admin's "Reset PIN" action (see users/actions.ts).
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const LoginSchema = z.object({
  phone: z.string().trim(),
  pin: z.string().trim(),
});

export type MLoginState = { error?: string } | undefined;

export async function loginSupervisor(
  _prevState: MLoginState,
  formData: FormData
): Promise<MLoginState> {
  const parsed = LoginSchema.safeParse({
    phone: formData.get("phone"),
    pin: formData.get("pin"),
  });

  if (!parsed.success || !parsed.data.phone || !parsed.data.pin) {
    return { error: "Enter your phone number and PIN." };
  }

  const { phone, pin } = parsed.data;

  // Same "don't reveal which case it was" discipline as the desktop login()
  // — wrong phone, wrong PIN, inactive account, and no-PIN-set all get the
  // same message. Lockout gets its own message below (a supervisor needs to
  // know why they can't get in at all, unlike a single wrong guess).
  const genericError = { error: "Incorrect phone number or PIN." };

  const user = await db.user.findUnique({ where: { phone } });
  if (!user || user.role !== "SITE_SUPERVISOR" || !user.isActive || !user.pinHash) {
    return genericError;
  }

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    return { error: "Too many wrong attempts. Try again in a few minutes." };
  }

  const valid = await verifyPin(pin, user.pinHash);

  if (!valid) {
    const attempts = user.pinFailedAttempts + 1;
    const locking = attempts >= LOCKOUT_THRESHOLD;
    await db.user.update({
      where: { id: user.id },
      data: {
        // Reset to 0 the moment a lock is applied, so the supervisor gets a
        // fresh 5 attempts once the 15-minute window passes, rather than
        // re-locking on their very next try.
        pinFailedAttempts: locking ? 0 : attempts,
        pinLockedUntil: locking ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
      },
    });
    return locking
      ? { error: "Too many wrong attempts. Try again in a few minutes." }
      : genericError;
  }

  await db.user.update({
    where: { id: user.id },
    data: { pinFailedAttempts: 0, pinLockedUntil: null },
  });

  await createSession(user.id);

  await writeAuditEvent(db, {
    actor: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
    },
    entityType: "User",
    entityId: user.id,
    action: "LOGIN",
    source: "mobile",
  });

  redirect("/m");
}
