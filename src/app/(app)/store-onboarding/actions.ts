"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canCreateOnboarding } from "@/lib/permissions";
import { createPasswordResetToken } from "@/lib/password-reset-tokens";
import { sendPasswordSetupEmail } from "@/lib/email";
import { generateReservedProjectId } from "@/lib/onboarding/ids";
import { Prisma } from "@prisma/client";

const CreateOnboardingSchema = z.object({
  brand: z.string().trim().min(1).default("Tulsi"),
  format: z.string().trim().min(1, "Format is required."),
  proposedLocation: z.string().trim().min(1, "Location is required."),
  legalApplicantName: z.string().trim().min(1, "Legal applicant name is required."),
  entityType: z.enum(["INDIVIDUAL", "COMPANY"]),
  contactPhone: z.string().trim().min(1, "Contact phone is required."),
  franchiseeName: z.string().trim().min(1, "Franchisee name is required."),
  workspaceEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: "Enter a valid Workspace email." }),
  salesOwnerId: z.string().min(1, "Sales owner is required."),
  expectedAmountRupees: z.coerce.number().positive("Fee amount must be greater than zero."),
});

export type ActionState = { error?: string } | undefined;

/**
 * P1-01 hard rule: one Workspace email = one store = one franchisee user.
 * Creates the franchisee User (no password — invite flow) and the
 * StoreOnboarding row (with a pre-reserved Project ID, section 17) in one
 * transaction, then sends the same invite email the admin "New User" flow
 * already uses (see src/lib/email.ts). Section 17 build-order step 8 will
 * route this key ("invitation") through the editable EmailTemplate table
 * without changing this call site's behavior.
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
    brand: formData.get("brand") || undefined,
    format: formData.get("format"),
    proposedLocation: formData.get("proposedLocation"),
    legalApplicantName: formData.get("legalApplicantName"),
    entityType: formData.get("entityType"),
    contactPhone: formData.get("contactPhone"),
    franchiseeName: formData.get("franchiseeName"),
    workspaceEmail: formData.get("workspaceEmail"),
    salesOwnerId: formData.get("salesOwnerId"),
    expectedAmountRupees: formData.get("expectedAmountRupees"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const [existingOnboarding, existingUser] = await Promise.all([
    db.storeOnboarding.findUnique({ where: { workspaceEmail: data.workspaceEmail } }),
    db.user.findUnique({ where: { email: data.workspaceEmail } }),
  ]);
  if (existingOnboarding || existingUser) {
    return { error: "A store or user with this Workspace email already exists." };
  }

  const salesOwner = await db.user.findUnique({ where: { id: data.salesOwnerId } });
  if (!salesOwner) {
    return { error: "Selected sales owner not found." };
  }

  let onboardingId: string;
  try {
    onboardingId = await db.$transaction(async (tx) => {
      const franchisee = await tx.user.create({
        data: {
          name: data.franchiseeName,
          email: data.workspaceEmail,
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
          workspaceEmail: data.workspaceEmail,
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
      await writeAuditEvent(tx, {
        actor: user,
        onboardingId: onboarding.id,
        entityType: "User",
        entityId: franchisee.id,
        action: "CREATE",
        newValue: { name: franchisee.name, email: franchisee.email, role: franchisee.role },
        reference: "Franchisee account created via store onboarding",
      });

      return onboarding.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "A store or user with this Workspace email already exists." };
    }
    throw err;
  }

  const onboarding = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboardingId } });
  const token = await createPasswordResetToken(onboarding.franchiseeUserId, "INVITE");
  try {
    await sendPasswordSetupEmail({
      to: onboarding.invitationEmail ?? onboarding.workspaceEmail,
      name: data.franchiseeName,
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
