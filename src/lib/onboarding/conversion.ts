import "server-only";

import type { Prisma } from "@prisma/client";
import { createWebsiteSiteInTx, findAvailableSiteName } from "@/lib/dashboard-site-create";

export type ConversionResult =
  | { converted: false }
  | {
      converted: true;
      dashboardSiteId: string;
      siteName: string;
      franchiseeEmail: string | null;
      franchiseeName: string;
      storeLabel: string;
    };

/**
 * LOI Complete -> the store's Dashboard site (plan.md section 13). One
 * transaction, idempotent (skip if the onboarding already has a site or is
 * already LOI_COMPLETE — the latter also covers an Admin later deleting the
 * site, which SetNulls `dashboardSiteId`). Called from the e-sign webhook
 * processor the instant the company signer completes
 * (src/lib/esign/webhook-processor.ts) — never called directly by any user
 * action, so there is exactly one trigger point.
 *
 * It creates exactly what Admin "New site" creates (shared helper
 * createWebsiteSiteInTx: DashboardSite + step template + the shared `Site` row
 * that surfaces it in Site Tracker / Site BOQ / Operations BOQ + the 11 Ops BOQ
 * rows), named "<Brand> - <Location>" (suffix " (2)"… if taken), then assigns
 * the franchisee to it (DashboardSiteAssignment, one site per user) so it is
 * the site they see on /dashboard. The signed LOI + certificate stay on the
 * LoiVersion row (no Document table on this branch) and are downloaded through
 * /api/loi-versions/[versionId]/download.
 *
 * Deliberately does NOT send the "loi_complete" email itself — Resend is a
 * network call, and holding it inside this same interactive Postgres
 * transaction risks the transaction timeout (same reasoning createOnboarding's
 * own invite email already follows: send after commit, not inside it). The
 * caller sends it using the returned info once its own transaction commits.
 */
export async function convertOnboardingToSite(
  tx: Prisma.TransactionClient,
  onboardingId: string
): Promise<ConversionResult> {
  const onboarding = await tx.storeOnboarding.findUniqueOrThrow({
    where: { id: onboardingId },
    include: { franchisee: true, currentLoiVersion: true },
  });

  // already converted — idempotent no-op
  if (onboarding.dashboardSiteId || onboarding.onboardingStatus === "LOI_COMPLETE") return { converted: false };

  const version = onboarding.currentLoiVersion;
  if (!version || version.status !== "SIGNED" || !version.signedPdfB2Key || !version.certificateB2Key) {
    // Should never happen — the webhook processor only calls this right
    // after marking the version SIGNED with both files stored. Defensive
    // guard rather than a silent partial conversion.
    throw new Error("Cannot convert: LOI version isn't fully signed yet.");
  }

  const storeLabel = `${onboarding.brand} ${onboarding.proposedLocation}`;
  const baseName = `${onboarding.brand} - ${onboarding.proposedLocation}`.replace(/\s+/g, " ").trim();
  const slots = await findAvailableSiteName(baseName);

  const created = await createWebsiteSiteInTx(tx, {
    name: slots.name,
    driveFolderUrl: null,
    deptLinksText: null,
    sortOrder: slots.nextSortOrder,
    trackerSortOrder: slots.nextTrackerSortOrder,
  });

  // The franchisee sees exactly this site on /dashboard (one site per user —
  // DashboardSiteAssignment.userId is unique). An earlier manual assignment to
  // another site is replaced, which is what "their store is now live" means.
  await tx.dashboardSiteAssignment.upsert({
    where: { userId: onboarding.franchiseeUserId },
    create: { userId: onboarding.franchiseeUserId, siteId: created.dashboardSiteId },
    update: { siteId: created.dashboardSiteId, assignedById: null },
  });

  await tx.storeOnboarding.update({
    where: { id: onboardingId },
    data: { dashboardSiteId: created.dashboardSiteId, onboardingStatus: "LOI_COMPLETE" },
  });

  await tx.auditEvent.create({
    data: {
      actorId: null,
      actorEmail: "system:esign",
      actorName: "Onboarding conversion",
      actorRole: "ADMIN",
      entityType: "DashboardSite",
      entityId: created.dashboardSiteId,
      action: "CREATE",
      newValue: {
        name: slots.name,
        steps: created.steps,
        trackerSiteId: created.trackerSiteId,
        opsBoqRows: created.opsBoqRows,
      },
      reference: "Created at LOI Complete (store onboarding)",
      source: "system:esign",
    },
  });
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
      oldValue: { onboardingStatus: onboarding.onboardingStatus, dashboardSiteId: null },
      newValue: { onboardingStatus: "LOI_COMPLETE", dashboardSiteId: created.dashboardSiteId },
      reference: "Converted to Dashboard site",
      source: "system:esign",
    },
  });

  return {
    converted: true,
    dashboardSiteId: created.dashboardSiteId,
    siteName: slots.name,
    franchiseeEmail: onboarding.franchisee.email,
    franchiseeName: onboarding.franchisee.name,
    storeLabel,
  };
}
