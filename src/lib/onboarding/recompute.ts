import "server-only";

import type { Prisma } from "@prisma/client";
import { deriveOnboardingStatus } from "./state";

type Tx = Prisma.TransactionClient;

/**
 * Single place that recomputes StoreOnboarding.kycStatus/paymentStatus
 * (denormalized mirrors, see schema.prisma) and onboardingStatus (derived —
 * see state.ts's deriveOnboardingStatus) from the underlying rows. Call this
 * at the end of every transaction that changes KYC/payment/LOI/e-sign state,
 * instead of setting those three fields by hand at each call site — keeps
 * plan.md section 17's "single source of truth" promise for real.
 */
export type RecomputeResult = { previousStatus: string; nextStatus: string };

export async function recomputeOnboardingStatus(tx: Tx, onboardingId: string): Promise<RecomputeResult> {
  const onboarding = await tx.storeOnboarding.findUniqueOrThrow({
    where: { id: onboardingId },
    include: {
      kyc: true,
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      currentLoiVersion: {
        include: {
          attempts: { orderBy: { attemptNo: "desc" } },
        },
      },
    },
  });

  const kycStatus = onboarding.kyc?.status ?? "MISSING";
  const latestPayment = onboarding.payments[0] ?? null;
  const paymentStatus = latestPayment?.status ?? "MISSING";

  const attempts = onboarding.currentLoiVersion?.attempts ?? [];
  const latestFranchiseAttempt = attempts.find((a) => a.signerRole === "FRANCHISEE");
  const latestCompanyAttempt = attempts.find((a) => a.signerRole === "COMPANY");

  const nextStatus = deriveOnboardingStatus({
    kycStatus,
    paymentStatus,
    verifiedAmount: latestPayment?.verifiedAmount ?? null,
    expectedAmount: onboarding.expectedAmount,
    loiVersionStatus: onboarding.currentLoiVersion?.status ?? null,
    franchiseSignCompleted: latestFranchiseAttempt?.status === "COMPLETED",
    companySignCompleted: latestCompanyAttempt?.status === "COMPLETED",
    isConverted: onboarding.projectId !== null,
  });

  await tx.storeOnboarding.update({
    where: { id: onboardingId },
    data: { kycStatus, paymentStatus, onboardingStatus: nextStatus },
  });

  return { previousStatus: onboarding.onboardingStatus, nextStatus };
}
