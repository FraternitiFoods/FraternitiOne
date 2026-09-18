"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import {
  validatePasswordResetToken,
  consumePasswordResetToken,
} from "@/lib/password-reset-tokens";

const SetPasswordSchema = z
  .object({
    password: z.string().min(8, { message: "Password must be at least 8 characters." }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type SetPasswordState = { error?: string } | undefined;

export async function setPassword(
  token: string,
  _prevState: SetPasswordState,
  formData: FormData
): Promise<SetPasswordState> {
  const parsed = SetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const validated = await validatePasswordResetToken(token);
  if (!validated) {
    return { error: "This link is invalid or has expired. Request a new one." };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const consumed = await consumePasswordResetToken(validated.id);
  if (!consumed) {
    return { error: "This link has already been used. Request a new one." };
  }

  const updatedUser = await db.user.update({
    where: { id: validated.userId },
    data: { passwordHash },
  });

  await writeAuditEvent(db, {
    actor: {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      department: updatedUser.department,
    },
    entityType: "User",
    entityId: updatedUser.id,
    action: "UPDATE",
    reference: validated.purpose === "INVITE" ? "Password set via invite link" : "Password reset",
  });

  // Setting a password successfully proves control of the account (the link
  // was emailed to it) — sign the user straight in rather than bouncing them
  // to /login to type the password they just chose.
  await createSession(updatedUser.id);

  redirect("/dashboard");
}
