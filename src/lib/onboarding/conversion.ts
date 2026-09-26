import "server-only";

import type { Prisma } from "@prisma/client";
import { createProjectWithSeedTasks } from "@/lib/project-seed";

export type ConversionResult =
  | { converted: false }
  | { converted: true; projectId: string; franchiseeEmail: string | null; franchiseeName: string; storeLabel: string };

/**
 * plan.md section 17 "Conversion to FranchiseProject (LOI Complete)" — one
 * transaction, idempotent (skip if StoreOnboarding.projectId already set).
 * Called from the e-sign webhook processor the instant the company signer
 * completes (src/lib/esign/webhook-processor.ts) — never called directly by
 * any user action, so there is exactly one trigger point.
 *
 * Deliberately does NOT send the "loi_complete" email itself — Resend is a
 * network call, and holding it inside this same interactive Postgres
 * transaction risks Prisma's default 5s transaction timeout (same reasoning
 * createOnboarding's own invite email already follows: send after commit,
 * not inside it). The caller sends it using the returned info once its own
 * transaction has actually committed.
 */
export async function convertOnboardingToProject(
  tx: Prisma.TransactionClient,
  onboardingId: string
): Promise<ConversionResult> {
  const onboarding = await tx.storeOnboarding.findUniqueOrThrow({
    where: { id: onboardingId },
    include: { franchisee: true, salesOwner: true, currentLoiVersion: true },
  });

  if (onboarding.projectId) return { converted: false }; // already converted — idempotent no-op

  const version = onboarding.currentLoiVersion;
  if (!version || version.status !== "SIGNED" || !version.signedPdfB2Key || !version.certificateB2Key) {
    // Should never happen — the webhook processor only calls this right
    // after marking the version SIGNED with both files stored. Defensive
    // guard rather than a silent partial conversion.
    throw new Error("Cannot convert: LOI version isn't fully signed yet.");
  }

  // 1. Create FranchiseProject with the reserved id, reusing the same
  //    project-creation + task-seeding path as /projects/new (step 0's own
  //    finding: do not reimplement task seeding).
  const project = await createProjectWithSeedTasks(tx, {
    id: onboarding.reservedProjectId,
    brand: onboarding.brand,
    format: onboarding.format,
    location: onboarding.proposedLocation,
    franchiseeId: onboarding.franchiseeUserId,
    ownerId: onboarding.salesOwnerId,
    targetOpening: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // +90 days — no target-opening input exists earlier in the onboarding flow (not asked for in the SRD); flagged as a default.
    // Task.createdById/AuditEvent.actorId need a real User — the sales
    // owner (a real internal staff member already tied to this onboarding)
    // stands in as the "actor" for this system-triggered creation, since
    // there is no signed-in user at conversion time (it runs from a
    // webhook). AuditEvent.reference below makes clear this was automatic.
    actor: {
      id: onboarding.salesOwnerId,
      name: onboarding.salesOwner.name,
      email: onboarding.salesOwner.email,
      role: onboarding.salesOwner.role,
    },
  });

  // 2. Mark the onboarding converted (idempotency guard for any future call).
  await tx.storeOnboarding.update({
    where: { id: onboardingId },
    data: { projectId: project.id, onboardingStatus: "LOI_COMPLETE" },
  });

  // 3. File the signed LOI + certificate under the new project as Document
  //    rows pointing at the same B2 objects (category Legal) — the KYC files
  //    themselves stay in OnboardingFile, restricted access (section 17).
  const signedLoiDoc = await tx.document.create({
    data: {
      projectId: project.id,
      category: "LEGAL",
      title: `Signed LOI v${version.versionNo}`,
      fileKey: version.signedPdfB2Key,
      fileName: `LOI-v${version.versionNo}-signed.pdf`,
      fileSize: 0,
      mimeType: "application/pdf",
      status: "APPROVED",
      ownerId: onboarding.franchiseeUserId,
    },
  });
  const certificateDoc = await tx.document.create({
    data: {
      projectId: project.id,
      category: "LEGAL",
      title: `LOI v${version.versionNo} signing certificate`,
      fileKey: version.certificateB2Key,
      fileName: `LOI-v${version.versionNo}-certificate.pdf`,
      fileSize: 0,
      mimeType: "application/pdf",
      status: "APPROVED",
      ownerId: onboarding.franchiseeUserId,
    },
  });

  // 4. Audit events (project CREATE already written by createProjectWithSeedTasks; document CREATE + onboarding UPDATE here).
  for (const doc of [signedLoiDoc, certificateDoc]) {
    await tx.auditEvent.create({
      data: {
        projectId: project.id,
        actorId: null,
        actorEmail: "system:esign",
        actorName: "Onboarding conversion",
        actorRole: "ADMIN",
        entityType: "Document",
        entityId: doc.id,
        action: "CREATE",
        newValue: { title: doc.title, fileKey: doc.fileKey },
        reference: "Filed at LOI Complete conversion",
        source: "system:esign",
      },
    });
  }
  await tx.auditEvent.create({
    data: {
      onboardingId,
      actorId: null,
      actorEmail: "system:esign",
      actorName: "Onboarding conversion",
      actorRole: "ADMIN",
      entityType: "StoreOnboarding",
      entityId: onboardingId,
      action: "UPDATE",
      oldValue: { onboardingStatus: onboarding.onboardingStatus, projectId: null },
      newValue: { onboardingStatus: "LOI_COMPLETE", projectId: project.id },
      reference: "Converted to FranchiseProject",
      source: "system:esign",
    },
  });

  return {
    converted: true,
    projectId: project.id,
    franchiseeEmail: onboarding.franchisee.email,
    franchiseeName: onboarding.franchisee.name,
    storeLabel: `${onboarding.brand} ${onboarding.proposedLocation}`,
  };
}
