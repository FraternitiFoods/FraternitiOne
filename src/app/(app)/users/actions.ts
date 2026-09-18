"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canManageUsers } from "@/lib/permissions";
import { createPasswordResetToken } from "@/lib/password-reset-tokens";
import { sendPasswordSetupEmail } from "@/lib/email";
import { Role, Department, Prisma } from "@prisma/client";

const CreateUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().toLowerCase().email({ message: "Enter a valid email." }),
  role: z.nativeEnum(Role),
  department: z.nativeEnum(Department).optional(),
});

export type ActionState = { error?: string } | undefined;

/**
 * Admin-only (canManageUsers, ADMIN role — see permissions.ts). Creates the
 * account with no password (User.passwordHash is nullable for exactly this
 * case) and emails an invite link (purpose "INVITE") that lets the new user
 * set their own password — see plan.md build log, 2026-09-18, for why: it
 * avoids repeating prisma/seed.ts's shared-password pattern for real users.
 */
export async function createUser(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const admin = await requireUser();

  if (!canManageUsers(admin)) {
    return { error: "You don't have permission to create users." };
  }

  const parsed = CreateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    department: formData.get("department") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;

  const existing = await db.user.findUnique({ where: { email: data.email } });
  if (existing) {
    return { error: "A user with this email already exists." };
  }

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        department: data.department,
        // No passwordHash — set via the invite link below.
      },
    });

    await writeAuditEvent(tx, {
      actor: admin,
      entityType: "User",
      entityId: created.id,
      action: "CREATE",
      newValue: {
        name: created.name,
        email: created.email,
        role: created.role,
        department: created.department,
      },
      reference: "Created via admin user management",
    });

    return created;
  });

  const token = await createPasswordResetToken(user.id, "INVITE");
  try {
    await sendPasswordSetupEmail({
      to: user.email,
      name: user.name,
      token,
      purpose: "INVITE",
    });
  } catch (err) {
    // The account was already created (and committed above) — don't roll
    // that back over an email-provider hiccup. Surface it clearly instead of
    // crashing, since silently swallowing this would leave the admin
    // thinking an invite went out when it didn't.
    console.error("Failed to send invite email:", err);
    return {
      error: `User "${user.email}" was created, but the invite email failed to send (check RESEND_API_KEY / EMAIL_FROM in .env). Use "Resend invite" once email is configured.`,
    };
  }

  redirect("/users");
}

export type ResendInviteState = { error?: string; success?: boolean } | undefined;

/** Re-sends the invite link for a user who hasn't set a password yet (see createUser). */
export async function resendInvite(
  userId: string,
  // Unused, but required by useActionState's (state, payload) action shape.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: ResendInviteState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<ResendInviteState> {
  const admin = await requireUser();

  if (!canManageUsers(admin)) {
    return { error: "You don't have permission to do this." };
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { error: "User not found." };
  }
  if (user.passwordHash) {
    return { error: "This user already set a password." };
  }

  const token = await createPasswordResetToken(user.id, "INVITE");
  try {
    await sendPasswordSetupEmail({ to: user.email, name: user.name, token, purpose: "INVITE" });
  } catch (err) {
    console.error("Failed to resend invite email:", err);
    return { error: "Invite email failed to send (check RESEND_API_KEY / EMAIL_FROM in .env)." };
  }

  revalidatePath("/users");
  return { success: true };
}

export type DeleteUserState = { error?: string; success?: boolean } | undefined;

/**
 * Every ownership FK on User (FranchiseProject.franchiseeId/ownerId,
 * Task.ownerId/createdById, Document.ownerId, TaskComment.authorId) is
 * `ON DELETE RESTRICT` (see prisma/migrations/20260915101650_init) — none of
 * those are nullable, so there's no safe value to fall back to. That means a
 * user who's actually been used anywhere (owns a project, a task, a
 * document) genuinely can't be deleted; Postgres will reject it and this
 * surfaces that as a clear message rather than a crash. Only an unused
 * account (e.g. one created with a typo'd role/email and never touched) can
 * actually be removed this way.
 */
export async function deleteUser(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: DeleteUserState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<DeleteUserState> {
  const admin = await requireUser();

  if (!canManageUsers(admin)) {
    return { error: "You don't have permission to do this." };
  }

  if (userId === admin.id) {
    return { error: "You can't delete your own account." };
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { error: "User not found." };
  }

  try {
    await db.$transaction(async (tx) => {
      await writeAuditEvent(tx, {
        actor: admin,
        entityType: "User",
        entityId: user.id,
        action: "DELETE",
        oldValue: { name: user.name, email: user.email, role: user.role, department: user.department },
        reference: "Deleted via admin user management",
      });
      await tx.user.delete({ where: { id: userId } });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return {
        error:
          "Can't delete — this user owns a project, task, or document. Remove/reassign those first.",
      };
    }
    throw err;
  }

  revalidatePath("/users");
  return { success: true };
}
