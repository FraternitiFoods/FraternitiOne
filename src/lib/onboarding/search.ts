import "server-only";

import type { LoiVersionStatus, OnboardingStatus, Prisma, ReviewStatus } from "@prisma/client";
import type { CurrentUser } from "@/lib/session";

/** Sentinel for "LOI not yet generated" — there's no currentLoiVersion row to filter on. */
export const LOI_NOT_GENERATED = "NOT_GENERATED" as const;

export type OnboardingListFilters = {
  q?: string;
  onboardingStatus?: OnboardingStatus;
  kycStatus?: ReviewStatus;
  paymentStatus?: ReviewStatus;
  loiStatus?: LoiVersionStatus | typeof LOI_NOT_GENERATED;
};

/**
 * plan.md section 20D: the search box covers franchisee name, phone,
 * workspace email, brand, location, store code (F1-xxxx), project code
 * (FR-xxxxx) and sales person. No PAN — it's AES-GCM encrypted (section 17),
 * so there's no plaintext/blind-index column to search against; decrypting
 * every row to scan would defeat the point of encrypting it.
 */
export function onboardingListWhere(
  user: Pick<CurrentUser, "role" | "id">,
  filters: OnboardingListFilters = {}
): Prisma.StoreOnboardingWhereInput {
  // SALES scoping belongs in the query, not just the UI (20D's explicit
  // instruction) — every other onboarding-touching role keeps the existing
  // full-queue visibility (canViewOnboarding's own reasoning, step-0 note).
  const scope: Prisma.StoreOnboardingWhereInput = user.role === "SALES" ? { salesOwnerId: user.id } : {};

  const search = filters.q?.trim();
  const onboardingCode = search?.match(/^f1-?0*(\d+)$/i);
  const projectCode = search?.match(/^fr-?0*(\d+)$/i);

  const searchWhere: Prisma.StoreOnboardingWhereInput = onboardingCode
    ? { seq: Number(onboardingCode[1]) }
    : projectCode
      ? { project: { seq: Number(projectCode[1]) } }
      : search
        ? {
            OR: [
              { legalApplicantName: { contains: search, mode: "insensitive" } },
              { contactPhone: { contains: search, mode: "insensitive" } },
              { workspaceEmail: { contains: search, mode: "insensitive" } },
              { brand: { contains: search, mode: "insensitive" } },
              { proposedLocation: { contains: search, mode: "insensitive" } },
              { franchisee: { name: { contains: search, mode: "insensitive" } } },
              { salesOwner: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {};

  return {
    ...scope,
    ...searchWhere,
    ...(filters.onboardingStatus ? { onboardingStatus: filters.onboardingStatus } : {}),
    ...(filters.kycStatus ? { kycStatus: filters.kycStatus } : {}),
    ...(filters.paymentStatus ? { paymentStatus: filters.paymentStatus } : {}),
    ...(filters.loiStatus === LOI_NOT_GENERATED
      ? { currentLoiVersionId: null }
      : filters.loiStatus
        ? { currentLoiVersion: { status: filters.loiStatus } }
        : {}),
  };
}
