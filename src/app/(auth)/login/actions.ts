"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { verifyPassword, requireUser } from "@/lib/auth";
import { createSession, deleteSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: "Enter a valid email." }),
  password: z.string().min(1, { message: "Password is required." }),
  next: z.string().optional(),
});

export type LoginState = { error?: string } | undefined;

export async function login(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { email, password, next } = parsed.data;

  const user = await db.user.findUnique({ where: { email } });

  // Same error for "no such user" and "wrong password" — don't leak which
  // one it was.
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Incorrect email or password." };
  }

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
  });

  const destination = next && next.startsWith("/") ? next : "/dashboard";
  redirect(destination);
}

export async function logout(): Promise<void> {
  const user = await requireUser();

  await writeAuditEvent(db, {
    actor: user,
    entityType: "User",
    entityId: user.id,
    action: "LOGOUT",
  });

  await deleteSession();
  redirect("/login");
}
