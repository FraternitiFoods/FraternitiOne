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
import { Role, Prisma } from "@prisma/client";
import { isApprovedEmailDomain, INVALID_EMAIL_DOMAIN_MESSAGE } from "@/lib/email-domain";

const CreateUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  role: z.nativeEnum(Role),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: "Enter a valid email." })
    .refine(isApprovedEmailDomain, { message: INVALID_EMAIL_DOMAIN_MESSAGE }),
});

export type ActionState = { error?: string } | undefined;

/**
 * Admin-only (canManageUsers, ADMIN role — see permissions.ts). Creates the
 * account with no password (User.passwordHash is nullable for exactly this
 * case) and emails an invite link (purpose "INVITE") that lets the new user
 * set their own password.
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
        // No passwordHash — set via the invite link below.
      },
    });

    await writeAuditEvent(tx, {
      actor: admin,
      entityType: "User",
      entityId: created.id,
      action: "CREATE",
      newValue: { name: created.name, email: created.email, role: created.role },
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

const UpdateUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: "Enter a valid email." })
    .refine(isApprovedEmailDomain, { message: INVALID_EMAIL_DOMAIN_MESSAGE }),
  role: z.nativeEnum(Role),
});

export type UpdateUserState = { error?: string } | undefined;

/** Admin-only. Editable: name, email, role. Password/isActive are separate flows. */
export async function updateUser(
  userId: string,
  _prevState: UpdateUserState,
  formData: FormData
): Promise<UpdateUserState> {
  const admin = await requireUser();

  if (!canManageUsers(admin)) {
    return { error: "You don't have permission to do this." };
  }

  const parsed = UpdateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { error: "User not found." };
  }

  const emailTaken = await db.user.findFirst({
    where: { email: data.email, id: { not: userId } },
  });
  if (emailTaken) {
    return { error: "A user with this email already exists." };
  }

  // Prevent a lockout: if this is the last active ADMIN, its role can't be
  // changed away from ADMIN (there would be nobody left who can manage users).
  if (user.role === "ADMIN" && data.role !== "ADMIN") {
    const otherActiveAdmins = await db.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: userId } },
    });
    if (otherActiveAdmins === 0) {
      return { error: "Can't change role — this is the last active System Admin." };
    }
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { name: data.name, email: data.email, role: data.role },
    });

    await writeAuditEvent(tx, {
      actor: admin,
      entityType: "User",
      entityId: updated.id,
      action: "UPDATE",
      oldValue: { name: user.name, email: user.email, role: user.role },
      newValue: { name: updated.name, email: updated.email, role: updated.role },
      reference: "Updated via admin user management",
    });
  });

  revalidatePath("/users");
  redirect("/users");
}

export type SetUserActiveState = { error?: string; success?: boolean } | undefined;

/**
 * Soft deactivate/reactivate (User.isActive) — the reversible alternative to
 * deleteUser's hard delete. session.ts's getCurrentUser rejects an inactive
 * user's session on the next request, so this takes effect immediately, not
 * just at next login.
 */
export async function setUserActive(
  userId: string,
  isActive: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: SetUserActiveState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<SetUserActiveState> {
  const admin = await requireUser();

  if (!canManageUsers(admin)) {
    return { error: "You don't have permission to do this." };
  }

  if (userId === admin.id) {
    return { error: "You can't deactivate your own account." };
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { error: "User not found." };
  }

  if (!isActive && user.role === "ADMIN") {
    const otherActiveAdmins = await db.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: userId } },
    });
    if (otherActiveAdmins === 0) {
      return { error: "Can't deactivate — this is the last active System Admin." };
    }
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive } });

    await writeAuditEvent(tx, {
      actor: admin,
      entityType: "User",
      entityId: user.id,
      action: "UPDATE",
      oldValue: { isActive: user.isActive },
      newValue: { isActive },
      reference: isActive
        ? "Reactivated via admin user management"
        : "Deactivated via admin user management",
    });
  });

  revalidatePath("/users");
  return { success: true };
}

export type DeleteUserState = { error?: string; success?: boolean } | undefined;

/**
 * Hard delete. Every remaining FK onto User (Session, PasswordResetToken,
 * AuditEvent.actorId) either cascades or sets null, so this can't fail on a
 * foreign-key restriction the way it could when Task/Document/FranchiseProject
 * ownership existed — unlike those, there's nothing left to reassign first.
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

  if (user.role === "ADMIN") {
    const otherActiveAdmins = await db.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: userId } },
    });
    if (otherActiveAdmins === 0) {
      return { error: "Can't delete — this is the last active System Admin." };
    }
  }

  try {
    await db.$transaction(async (tx) => {
      await writeAuditEvent(tx, {
        actor: admin,
        entityType: "User",
        entityId: user.id,
        action: "DELETE",
        oldValue: { name: user.name, email: user.email, role: user.role },
        reference: "Deleted via admin user management",
      });
      await tx.user.delete({ where: { id: userId } });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return { error: "Couldn't delete this user — please try again." };
    }
    throw err;
  }

  revalidatePath("/users");
  return { success: true };
}
