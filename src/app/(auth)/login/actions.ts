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

// P1-02: email+password login needs rate limiting and lockout. Mirrors the
// mobile PIN pattern already shipped (plan.md section 16) — 5 consecutive
// wrong attempts locks the account for 15 minutes, resetting on a correct
// login. Step 0 confirmed no such lockout existed before this section.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

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

  if (user && user.loginLockedUntil && user.loginLockedUntil > new Date()) {
    return {
      error: "Too many wrong attempts. This account is locked for 15 minutes — try again later.",
    };
  }

  const passwordOk =
    !!user && !!user.isActive && !!user.passwordHash && (await verifyPassword(password, user.passwordHash));

  if (!passwordOk) {
    // Only a real, active, password-set account can actually be locked out —
    // an unknown email still gets the same generic message (don't leak which
    // case it was), but there's no row to increment a counter on.
    if (user && user.isActive) {
      const attempts = user.loginFailedAttempts + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          loginFailedAttempts: attempts,
          loginLockedUntil:
            attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
        },
      });
    }
    return { error: "Incorrect email or password." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { loginFailedAttempts: 0, loginLockedUntil: null },
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
  });

  // plan.md section 17: a FRANCHISEE with a non-complete StoreOnboarding
  // lands on their onboarding portal instead of /dashboard. A franchisee
  // with no onboarding record (existing seeded/real users) or a completed
  // one keeps today's behaviour exactly — no regression to existing
  // franchisee/project flows.
  if (user.role === "FRANCHISEE" && (!next || next === "/dashboard")) {
    const onboarding = await db.storeOnboarding.findUnique({
      where: { franchiseeUserId: user.id },
      select: { onboardingStatus: true },
    });
    if (onboarding && onboarding.onboardingStatus !== "LOI_COMPLETE") {
      redirect("/onboarding");
    }
  }

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
