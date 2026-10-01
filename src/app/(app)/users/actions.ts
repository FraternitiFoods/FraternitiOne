"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser, hashPin } from "@/lib/auth";
import type { CurrentUser } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { canManageUsers } from "@/lib/permissions";
import { createPasswordResetToken } from "@/lib/password-reset-tokens";
import { sendPasswordSetupEmail } from "@/lib/email";
import { Role, Department, Prisma } from "@prisma/client";
import { formatProjectCode } from "@/lib/format";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { isApprovedEmailDomain, INVALID_EMAIL_DOMAIN_MESSAGE } from "@/lib/email-domain";

/// plan.md section 16, decision 7 — a SITE_SUPERVISOR logs in with phone+PIN,
/// not email+password, and has no email channel to receive an invite link
/// through (decision 8: no notifications). So unlike every other role, the
/// admin sets the PIN directly at creation time — there's no viable
/// alternative given the other decisions already locked in.
const PHONE_PATTERN = /^[0-9]{10}$/;
const PIN_PATTERN = /^[0-9]{6}$/; // 6 digits, confirmed 2026-09-24

const CreateUserSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required."),
    role: z.nativeEnum(Role),
    department: z.nativeEnum(Department).optional(),
    email: z.string().trim().toLowerCase().optional(),
    phone: z.string().trim().optional(),
    pin: z.string().optional(),
    confirmPin: z.string().optional(),
    projectIds: z.array(z.string()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "SITE_SUPERVISOR") {
      if (!data.phone || !PHONE_PATTERN.test(data.phone)) {
        ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a 10-digit phone number." });
      }
      if (!data.pin || !PIN_PATTERN.test(data.pin)) {
        ctx.addIssue({ code: "custom", path: ["pin"], message: "PIN must be exactly 6 digits." });
      } else if (data.pin !== data.confirmPin) {
        ctx.addIssue({ code: "custom", path: ["confirmPin"], message: "PINs don't match." });
      }
      if (!data.projectIds || data.projectIds.length === 0) {
        ctx.addIssue({ code: "custom", path: ["projectIds"], message: "Assign at least one project." });
      }
    } else if (!data.email || !z.string().email().safeParse(data.email).success) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Enter a valid email." });
    } else if (!isApprovedEmailDomain(data.email)) {
      ctx.addIssue({ code: "custom", path: ["email"], message: INVALID_EMAIL_DOMAIN_MESSAGE });
    } else if (data.role === "COMPANY_SIGNATORY" && (!data.phone || !PHONE_PATTERN.test(data.phone))) {
      // plan.md section 19, "NOT DECIDED YET" #4 (resolved): the company
      // signatory signs by OTP to this number, so it can't be left empty —
      // same 10-digit shape as the SITE_SUPERVISOR phone above, just a
      // second purpose for the same column (login credential there, OTP
      // destination here).
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a 10-digit mobile number for the company signatory's OTP." });
    } else if (data.role === "ADMIN" && data.phone && !PHONE_PATTERN.test(data.phone)) {
      // Optional for Admin (canCompanySignNow lets ADMIN stand in for the
      // company signatory) — only validated if they choose to set one, so
      // they can also countersign LOIs by OTP without needing a dedicated
      // COMPANY_SIGNATORY account.
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a 10-digit mobile number." });
    }
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
    email: formData.get("email") || undefined,
    role: formData.get("role"),
    department: formData.get("department") || undefined,
    phone: formData.get("phone") || undefined,
    pin: formData.get("pin") || undefined,
    confirmPin: formData.get("confirmPin") || undefined,
    projectIds: formData.getAll("projectIds"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;

  if (data.role === "SITE_SUPERVISOR") {
    return createSupervisor(admin, data);
  }

  // superRefine already guarantees this for a non-supervisor role, but the
  // Zod-inferred type stays `string | undefined` (superRefine doesn't narrow
  // sibling fields) — this both satisfies TS and is a real belt-and-braces
  // check.
  if (!data.email) {
    return { error: "Enter a valid email." };
  }

  const existing = await db.user.findUnique({ where: { email: data.email } });
  if (existing) {
    return { error: "A user with this email already exists." };
  }
  if ((data.role === "COMPANY_SIGNATORY" || data.role === "ADMIN") && data.phone) {
    const existingPhone = await db.user.findUnique({ where: { phone: data.phone } });
    if (existingPhone) {
      return { error: "A user with this phone number already exists." };
    }
  }

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        department: data.department,
        phone: data.role === "COMPANY_SIGNATORY" || data.role === "ADMIN" ? data.phone : undefined,
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
    // `data.email` (guaranteed string from CreateUserSchema), not
    // `user.email` — same value, but User.email is nullable at the type
    // level now that SITE_SUPERVISOR accounts can have none (plan.md
    // section 16). This form still always collects an email, so this stays
    // exactly as it worked before.
    await sendPasswordSetupEmail({
      to: data.email,
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
      error: `User "${data.email}" was created, but the invite email failed to send (check RESEND_API_KEY / EMAIL_FROM in .env). Use "Resend invite" once email is configured.`,
    };
  }

  redirect("/users");
}

/**
 * Site-supervisor branch of createUser (plan.md section 16, build order
 * step 2). No email/invite-link path at all — phone+PIN is the whole
 * credential, set by the admin directly right here, and `ProjectMember` rows
 * are created in the same transaction as the user so a supervisor is never
 * left existing-but-unassigned even momentarily.
 */
async function createSupervisor(
  admin: CurrentUser,
  data: z.infer<typeof CreateUserSchema>
): Promise<ActionState> {
  // superRefine guarantees these for role === SITE_SUPERVISOR; narrow here
  // for TS (see the sibling comment in createUser) and as a real guard.
  if (!data.phone || !data.pin || !data.projectIds || data.projectIds.length === 0) {
    return { error: "Invalid input." };
  }
  const { phone, pin, projectIds } = data;

  const existingPhone = await db.user.findUnique({ where: { phone } });
  if (existingPhone) {
    return { error: "A user with this phone number already exists." };
  }

  const projects = await db.franchiseProject.findMany({
    where: { id: { in: projectIds } },
    select: { id: true },
  });
  if (projects.length !== projectIds.length) {
    return { error: "One or more selected projects couldn't be found." };
  }

  const pinHash = await hashPin(pin);

  await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: data.name,
        role: "SITE_SUPERVISOR",
        phone,
        pinHash,
        // No department — a supervisor's access is ProjectMember-scoped
        // (see role-departments.ts), not department-scoped.
      },
    });

    await writeAuditEvent(tx, {
      actor: admin,
      entityType: "User",
      entityId: created.id,
      action: "CREATE",
      newValue: { name: created.name, role: created.role, phone: created.phone },
      reference: "Created via admin user management (site supervisor)",
    });

    const members = await tx.projectMember.createManyAndReturn({
      data: projectIds.map((projectId) => ({ userId: created.id, projectId })),
    });

    await tx.auditEvent.createMany({
      data: members.map((m) => ({
        projectId: m.projectId,
        actorId: admin.id,
        actorEmail: admin.email ?? "(no email on file)",
        actorName: admin.name,
        actorRole: admin.role,
        entityType: "ProjectMember",
        entityId: m.id,
        action: "CREATE" as const,
        newValue: { userId: created.id, projectId: m.projectId },
        reference: "Supervisor assigned via admin user management",
        source: "web",
      })),
    });
  });

  redirect("/users");
}

const ResetPinSchema = z
  .object({
    pin: z.string(),
    confirmPin: z.string(),
  })
  .superRefine((data, ctx) => {
    if (!PIN_PATTERN.test(data.pin)) {
      ctx.addIssue({ code: "custom", path: ["pin"], message: "PIN must be exactly 6 digits." });
    } else if (data.pin !== data.confirmPin) {
      ctx.addIssue({ code: "custom", path: ["confirmPin"], message: "PINs don't match." });
    }
  });

export type ResetPinState = { error?: string; success?: boolean } | undefined;

/** Admin-only. Resets a site supervisor's PIN — the phone+PIN equivalent of "Resend invite". */
export async function resetPin(
  userId: string,
  _prevState: ResetPinState,
  formData: FormData
): Promise<ResetPinState> {
  const admin = await requireUser();

  if (!canManageUsers(admin)) {
    return { error: "You don't have permission to do this." };
  }

  const parsed = ResetPinSchema.safeParse({
    pin: formData.get("pin"),
    confirmPin: formData.get("confirmPin"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { error: "User not found." };
  }
  if (user.role !== "SITE_SUPERVISOR") {
    return { error: "This account doesn't use a PIN." };
  }

  const pinHash = await hashPin(parsed.data.pin);

  await db.$transaction(async (tx) => {
    // Also clears any active brute-force lockout (plan.md section 16, PIN
    // rules item 3) — confirmed 2026-09-24: an admin resetting the PIN is the
    // escape hatch for a locked-out supervisor, not just a forgotten PIN.
    await tx.user.update({
      where: { id: userId },
      data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
    });
    await writeAuditEvent(tx, {
      actor: admin,
      entityType: "User",
      entityId: userId,
      action: "UPDATE",
      reference: "PIN reset via admin user management",
    });
  });

  revalidatePath("/users");
  return { success: true };
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
  if (!user.email) {
    return { error: "This account has no email on file — can't resend an email invite." };
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

const UpdateUserSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required."),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email({ message: "Enter a valid email." })
      .refine(isApprovedEmailDomain, { message: INVALID_EMAIL_DOMAIN_MESSAGE }),
    // This form is email+password only (no phone/PIN fields) — SITE_SUPERVISOR
    // isn't a valid target here, same reasoning as excluding it from the role
    // dropdown in new-user-form.tsx. COMPANY_SIGNATORY is the one other role
    // that needs a phone (OTP destination, plan.md section 19), handled below.
    role: z.nativeEnum(Role).refine((r) => r !== "SITE_SUPERVISOR", {
      message: "Site supervisors can't be edited from this form yet.",
    }),
    department: z.nativeEnum(Department).optional(),
    phone: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "COMPANY_SIGNATORY" && (!data.phone || !PHONE_PATTERN.test(data.phone))) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a 10-digit mobile number for the company signatory's OTP." });
    } else if (data.role === "ADMIN" && data.phone && !PHONE_PATTERN.test(data.phone)) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a 10-digit mobile number." });
    }
  });

export type UpdateUserState = { error?: string } | undefined;

/** Admin-only. Editable: name, email, role, department. Password/isActive are separate flows. */
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
    department: formData.get("department") || undefined,
    phone: formData.get("phone") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { error: "User not found." };
  }
  if (user.role === "SITE_SUPERVISOR") {
    return {
      error: "Editing site supervisors isn't supported yet — use Reset PIN or Delete from the users list.",
    };
  }

  const emailTaken = await db.user.findFirst({
    where: { email: data.email, id: { not: userId } },
  });
  if (emailTaken) {
    return { error: "A user with this email already exists." };
  }
  if ((data.role === "COMPANY_SIGNATORY" || data.role === "ADMIN") && data.phone) {
    const phoneTaken = await db.user.findFirst({ where: { phone: data.phone, id: { not: userId } } });
    if (phoneTaken) {
      return { error: "A user with this phone number already exists." };
    }
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
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        department: data.department ?? null,
        phone: data.role === "COMPANY_SIGNATORY" || data.role === "ADMIN" ? data.phone : undefined,
      },
    });

    await writeAuditEvent(tx, {
      actor: admin,
      entityType: "User",
      entityId: updated.id,
      action: "UPDATE",
      oldValue: { name: user.name, email: user.email, role: user.role, department: user.department, phone: user.phone },
      newValue: {
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
        department: updated.department,
      },
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

export type DeletionBlocker = { label: string; href: string };

export type DeleteUserState =
  | {
      error?: string;
      success?: boolean;
      /** Specific records blocking deletion, each linking straight to where
       * an admin can reassign/delete it — see findDeletionBlockers below. */
      blockers?: DeletionBlocker[];
      /** Set when there's more blocking the delete than `blockers` lists
       * (e.g. a prolific task author) — a plain-text hint, not another link. */
      blockersNote?: string;
    }
  | undefined;

// Kept low: this is a "here's where to go" list for a modal, not a full
// report — an account genuinely too entangled to unblock item-by-item should
// be deactivated (see setUserActive) instead of chased across dozens of links.
const BLOCKER_LIST_LIMIT = 5;

/**
 * Looks up exactly what's still pointing at this user, for every FK that's
 * `ON DELETE RESTRICT` and would otherwise surface as an opaque P2003 (see
 * deleteUser below). Each result links straight to the project/task/
 * document/onboarding record so the admin can reassign or delete it there,
 * instead of having to go hunting for it.
 */
async function findDeletionBlockers(userId: string): Promise<{
  blockers: DeletionBlocker[];
  note?: string;
}> {
  const [
    projectsOwned,
    projectsFranchisee,
    tasksOwned,
    tasksCreated,
    documentsOwned,
    commentCount,
    onboardings,
    onboardingFilesCount,
  ] = await Promise.all([
    db.franchiseProject.findMany({
      where: { ownerId: userId },
      select: { id: true, seq: true, brand: true, location: true },
      take: BLOCKER_LIST_LIMIT,
    }),
    db.franchiseProject.findMany({
      where: { franchiseeId: userId },
      select: { id: true, seq: true, brand: true, location: true },
      take: BLOCKER_LIST_LIMIT,
    }),
    db.task.findMany({
      where: { ownerId: userId },
      select: { id: true, title: true, lifecycleStage: true, projectId: true, project: { select: { seq: true } } },
      take: BLOCKER_LIST_LIMIT,
    }),
    db.task.findMany({
      where: { createdById: userId },
      select: { id: true, title: true, lifecycleStage: true, projectId: true, project: { select: { seq: true } } },
      take: BLOCKER_LIST_LIMIT,
    }),
    db.document.findMany({
      where: { ownerId: userId },
      select: { id: true, title: true, projectId: true, project: { select: { seq: true } } },
      take: BLOCKER_LIST_LIMIT,
    }),
    db.taskComment.count({ where: { authorId: userId } }),
    db.storeOnboarding.findMany({
      where: { OR: [{ franchiseeUserId: userId }, { salesOwnerId: userId }] },
      select: { id: true, seq: true, legalApplicantName: true },
      take: BLOCKER_LIST_LIMIT,
    }),
    db.onboardingFile.count({ where: { uploadedById: userId } }),
  ]);

  const blockers: DeletionBlocker[] = [
    ...projectsOwned.map((p) => ({
      label: `${formatProjectCode(p.seq)} — ${p.brand} ${p.location} (project owner)`,
      href: `/projects/${p.id}`,
    })),
    ...projectsFranchisee.map((p) => ({
      label: `${formatProjectCode(p.seq)} — ${p.brand} ${p.location} (franchisee)`,
      href: `/projects/${p.id}`,
    })),
    ...tasksOwned.map((t) => ({
      label: `"${t.title}" in ${formatProjectCode(t.project.seq)} (task owner)`,
      href: `/projects/${t.projectId}/stages/${t.lifecycleStage}#task-${t.id}`,
    })),
    ...tasksCreated.map((t) => ({
      label: `"${t.title}" in ${formatProjectCode(t.project.seq)} (created task)`,
      href: `/projects/${t.projectId}/stages/${t.lifecycleStage}#task-${t.id}`,
    })),
    ...documentsOwned.map((d) => ({
      label: `"${d.title}" in ${formatProjectCode(d.project.seq)} (document owner)`,
      href: `/projects/${d.projectId}#document-${d.id}`,
    })),
    ...onboardings.map((o) => ({
      label: `${formatOnboardingCode(o.seq)} — ${o.legalApplicantName} (onboarding)`,
      href: `/store-onboarding/${o.id}`,
    })),
  ];

  const noteParts: string[] = [];
  if (commentCount > 0) {
    noteParts.push(`${commentCount} task comment${commentCount === 1 ? "" : "s"} authored`);
  }
  if (onboardingFilesCount > 0) {
    noteParts.push(`${onboardingFilesCount} onboarding file${onboardingFilesCount === 1 ? "" : "s"} uploaded`);
  }

  return {
    blockers,
    note: noteParts.length > 0 ? `Also has: ${noteParts.join(", ")}.` : undefined,
  };
}

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
      const { blockers, note } = await findDeletionBlockers(userId);
      return {
        error:
          blockers.length > 0
            ? "Can't delete — reassign or delete these first:"
            : "Can't delete — this user owns a project, task, or document. Remove/reassign those first.",
        blockers,
        blockersNote: note,
      };
    }
    throw err;
  }

  revalidatePath("/users");
  return { success: true };
}
