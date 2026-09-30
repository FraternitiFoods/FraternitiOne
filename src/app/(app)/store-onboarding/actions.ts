"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canCreateOnboarding, canManageOnboardingAdmin } from "@/lib/permissions";
import { createPasswordResetToken } from "@/lib/password-reset-tokens";
import { sendPasswordSetupEmail } from "@/lib/email";
import { generateReservedProjectId } from "@/lib/onboarding/ids";
import { isApprovedEmailDomain, INVALID_EMAIL_DOMAIN_MESSAGE } from "@/lib/email-domain";
import { Prisma } from "@prisma/client";

const BaseOnboardingFields = {
  brand: z.string().trim().min(1).default("Tulsi"),
  format: z.string().trim().min(1, "Format is required."),
  proposedLocation: z.string().trim().min(1, "Location is required."),
  legalApplicantName: z.string().trim().min(1, "Legal applicant name is required."),
  entityType: z.enum(["INDIVIDUAL", "COMPANY"]),
  contactPhone: z.string().trim().min(1, "Contact phone is required."),
  salesOwnerId: z.string().min(1, "Sales owner is required."),
  expectedAmountRupees: z.coerce.number().positive("Fee amount must be greater than zero."),
};

// "new" mints a fresh franchisee User + sends the invite, same as before.
// "existing" attaches an already-created, not-yet-linked FRANCHISEE user
// (e.g. provisioned ahead of time via /users/new) — no second account, no
// second invite. franchiseeName/workspaceEmail aren't collected in that
// case; the existing user's own name/email are used, straight from the DB,
// never from client input.
const CreateOnboardingSchema = z.discriminatedUnion("accountMode", [
  z.object({
    accountMode: z.literal("new"),
    ...BaseOnboardingFields,
    franchiseeName: z.string().trim().min(1, "Franchisee name is required."),
    workspaceEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email({ message: "Enter a valid Workspace email." })
      .refine(isApprovedEmailDomain, { message: INVALID_EMAIL_DOMAIN_MESSAGE }),
  }),
  z.object({
    accountMode: z.literal("existing"),
    ...BaseOnboardingFields,
    existingUserId: z.string().min(1, "Select an existing franchisee account."),
  }),
]);

export type ActionState = { error?: string } | undefined;

/**
 * P1-01 hard rule: one Workspace email = one store = one franchisee user.
 * Still holds either way — `accountMode: "new"` mints the franchisee User
 * here (no password — invite flow) and emails the same invite the admin
 * "New User" flow uses (see src/lib/email.ts); `accountMode: "existing"`
 * links a User that was already created with role FRANCHISEE and isn't yet
 * attached to any StoreOnboarding, and skips the invite since that login
 * already went out (or was set up) when the account was first created.
 * Either way, the StoreOnboarding row (with a pre-reserved Project ID,
 * section 17) is written in one transaction. Section 17 build-order step 8
 * will route the invite key ("invitation") through the editable
 * EmailTemplate table without changing this call site's behavior.
 */
export async function createOnboarding(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!canCreateOnboarding(user)) {
    return { error: "You don't have permission to create a store onboarding." };
  }

  const parsed = CreateOnboardingSchema.safeParse({
    accountMode: formData.get("accountMode"),
    brand: formData.get("brand") || undefined,
    format: formData.get("format"),
    proposedLocation: formData.get("proposedLocation"),
    legalApplicantName: formData.get("legalApplicantName"),
    entityType: formData.get("entityType"),
    contactPhone: formData.get("contactPhone"),
    franchiseeName: formData.get("franchiseeName"),
    workspaceEmail: formData.get("workspaceEmail"),
    existingUserId: formData.get("existingUserId"),
    salesOwnerId: formData.get("salesOwnerId"),
    expectedAmountRupees: formData.get("expectedAmountRupees"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const salesOwner = await db.user.findUnique({ where: { id: data.salesOwnerId } });
  if (!salesOwner) {
    return { error: "Selected sales owner not found." };
  }

  // Resolved before the transaction: either the to-be-created account's
  // email (new mode) or the already-existing account's own name/email
  // (existing mode). Either way this is what ends up as
  // StoreOnboarding.workspaceEmail, so the P1-01 uniqueness check below
  // covers both paths identically.
  let franchiseeName: string;
  let workspaceEmail: string;
  let existingFranchiseeId: string | null = null;

  if (data.accountMode === "existing") {
    const existingFranchisee = await db.user.findUnique({ where: { id: data.existingUserId } });
    if (!existingFranchisee || existingFranchisee.role !== "FRANCHISEE" || !existingFranchisee.isActive) {
      return { error: "Selected franchisee account not found or not eligible." };
    }
    if (!existingFranchisee.email) {
      return { error: "Selected franchisee account has no email on file." };
    }
    const alreadyLinked = await db.storeOnboarding.findUnique({
      where: { franchiseeUserId: existingFranchisee.id },
    });
    if (alreadyLinked) {
      return { error: "Selected franchisee account is already linked to another store." };
    }
    franchiseeName = existingFranchisee.name;
    workspaceEmail = existingFranchisee.email;
    existingFranchiseeId = existingFranchisee.id;
  } else {
    franchiseeName = data.franchiseeName;
    workspaceEmail = data.workspaceEmail;
  }

  const [existingOnboarding, existingUserByEmail] = await Promise.all([
    db.storeOnboarding.findUnique({ where: { workspaceEmail } }),
    // Only relevant for "new" mode — "existing" mode's user is expected to
    // already exist under this email, that's the whole point.
    data.accountMode === "new" ? db.user.findUnique({ where: { email: workspaceEmail } }) : null,
  ]);
  if (existingOnboarding || existingUserByEmail) {
    return { error: "A store or user with this Workspace email already exists." };
  }

  let onboardingId: string;
  try {
    onboardingId = await db.$transaction(async (tx) => {
      const franchisee =
        existingFranchiseeId !== null
          ? { id: existingFranchiseeId }
          : await tx.user.create({
              data: {
                name: franchiseeName,
                email: workspaceEmail,
                role: "FRANCHISEE",
              },
            });

      const onboarding = await tx.storeOnboarding.create({
        data: {
          reservedProjectId: generateReservedProjectId(),
          brand: data.brand,
          format: data.format,
          proposedLocation: data.proposedLocation,
          legalApplicantName: data.legalApplicantName,
          entityType: data.entityType,
          contactPhone: data.contactPhone,
          workspaceEmail,
          franchiseeUserId: franchisee.id,
          salesOwnerId: data.salesOwnerId,
          expectedAmount: Math.round(data.expectedAmountRupees * 100),
        },
      });

      await tx.kycSubmission.create({ data: { onboardingId: onboarding.id } });

      await writeAuditEvent(tx, {
        actor: user,
        onboardingId: onboarding.id,
        entityType: "StoreOnboarding",
        entityId: onboarding.id,
        action: "CREATE",
        newValue: {
          brand: onboarding.brand,
          format: onboarding.format,
          proposedLocation: onboarding.proposedLocation,
          workspaceEmail: onboarding.workspaceEmail,
          reservedProjectId: onboarding.reservedProjectId,
          expectedAmount: onboarding.expectedAmount,
        },
        reference: "Created via /store-onboarding/new",
      });
      if (existingFranchiseeId === null) {
        await writeAuditEvent(tx, {
          actor: user,
          onboardingId: onboarding.id,
          entityType: "User",
          entityId: franchisee.id,
          action: "CREATE",
          newValue: { name: franchiseeName, email: workspaceEmail, role: "FRANCHISEE" },
          reference: "Franchisee account created via store onboarding",
        });
      } else {
        await writeAuditEvent(tx, {
          actor: user,
          onboardingId: onboarding.id,
          entityType: "User",
          entityId: franchisee.id,
          action: "UPDATE",
          newValue: { linkedOnboardingId: onboarding.id },
          reference: "Existing franchisee account linked via store onboarding",
        });
      }

      return onboarding.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "A store or user with this Workspace email already exists." };
    }
    throw err;
  }

  // Existing-account mode reuses a login that was already invited (or
  // already has a password) when the account was first created — sending
  // another invite here would just be a second, confusing invite for the
  // same login. New-account mode still needs its first invite.
  if (existingFranchiseeId !== null) {
    redirect(`/store-onboarding/${onboardingId}`);
  }

  const onboarding = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboardingId } });
  const token = await createPasswordResetToken(onboarding.franchiseeUserId, "INVITE");
  try {
    await sendPasswordSetupEmail({
      to: onboarding.invitationEmail ?? onboarding.workspaceEmail,
      name: franchiseeName,
      token,
      purpose: "INVITE",
    });
  } catch (err) {
    // The onboarding + franchisee account were already created and
    // committed — surface the email failure clearly rather than rolling
    // back, same discipline as createUser's own invite-email catch.
    console.error("Failed to send onboarding invite email:", err);
    redirect(`/store-onboarding/${onboardingId}?inviteError=1`);
  }

  redirect(`/store-onboarding/${onboardingId}`);
}

export type DeleteOnboardingState = { error?: string; success?: boolean } | undefined;

/**
 * Admin-only. Hard delete — OnboardingFile, KycSubmission, PaymentSubmission
 * and LoiVersion (and its EsignAttempt/EsignEvent chain) all cascade via
 * `onDelete: Cascade` back to StoreOnboarding (see schema.prisma), so this is
 * the single entry point for wiping a store's onboarding history.
 * AuditEvent.onboardingId is `onDelete: SetNull`, so the audit trail survives.
 *
 * Deliberately does NOT touch the franchisee User row — that account may
 * still be a live login, and it's deletable on its own (via the Users page)
 * once nothing else references it. Also refuses once `projectId` is set:
 * past that point this onboarding is the historical record behind a real,
 * live FranchiseProject, not a leftover to clean up — delete the project
 * instead if that's really the intent.
 */
export async function deleteOnboarding(
  onboardingId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: DeleteOnboardingState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<DeleteOnboardingState> {
  const user = await requireUser();

  if (!canManageOnboardingAdmin(user)) {
    return { error: "You don't have permission to do this." };
  }

  const onboarding = await db.storeOnboarding.findUnique({ where: { id: onboardingId } });
  if (!onboarding) {
    return { error: "Onboarding not found." };
  }
  if (onboarding.projectId) {
    return {
      error: "Can't delete — this onboarding already converted to a live project. Delete the project instead.",
    };
  }

  await db.$transaction(async (tx) => {
    await writeAuditEvent(tx, {
      actor: user,
      onboardingId: onboarding.id,
      entityType: "StoreOnboarding",
      entityId: onboarding.id,
      action: "DELETE",
      oldValue: {
        brand: onboarding.brand,
        proposedLocation: onboarding.proposedLocation,
        workspaceEmail: onboarding.workspaceEmail,
        franchiseeUserId: onboarding.franchiseeUserId,
      },
      reference: "Deleted via Store Onboarding admin controls",
    });
    await tx.storeOnboarding.delete({ where: { id: onboardingId } });
  });

  revalidatePath("/store-onboarding");
  return { success: true };
}
