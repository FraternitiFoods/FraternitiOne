"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canReviewKyc, canReviewPayment } from "@/lib/permissions";
import { transitionReview } from "@/lib/onboarding/state";
import { recomputeOnboardingStatus } from "@/lib/onboarding/recompute";
import { sendOnboardingEmail, notifyIfNewlyReadyForSignature } from "@/lib/onboarding/notify";

// { success: true } rather than redirect() — DecisionForm (decision-form.tsx)
// calls these two actions as plain functions from a Client Component (not
// via `<form action={...}>`, see that file's own comment for why), and lets
// the client navigate/refresh on success instead. Keeps this file consistent
// with every other direct-call action in src/app/onboarding and src/app/(app)/signing.
export type ReviewActionState = { error?: string; success?: boolean } | undefined;

/** P1-13: a reject/changes-requested reason is mandatory. Shared by both decide* actions below. */
function requireReasonIfRejecting(decision: string, reason: string): string | null {
  if (decision === "REQUEST_CHANGES" && !reason.trim()) {
    return "A reason is required when requesting changes.";
  }
  return null;
}

export async function decideKyc(
  onboardingId: string,
  _prevState: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  const user = await requireUser();
  if (!canReviewKyc(user)) {
    return { error: "You don't have permission to review KYC." };
  }

  const decision = String(formData.get("decision") || "");
  const reason = String(formData.get("reason") || "");
  const reasonError = requireReasonIfRejecting(decision, reason);
  if (reasonError) return { error: reasonError };
  if (decision !== "ACCEPT" && decision !== "REQUEST_CHANGES") {
    return { error: "Invalid decision." };
  }

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId },
    include: { kyc: true, franchisee: true },
  });
  if (!onboarding || !onboarding.kyc) {
    return { error: "Onboarding not found." };
  }
  if (onboarding.kyc.status !== "SUBMITTED") {
    return { error: "This KYC submission isn't awaiting review." };
  }

  const event = decision === "ACCEPT" ? "ACCEPT" : "REQUEST_CHANGES";
  const nextStatus = transitionReview(onboarding.kyc.status, event);

  const recompute = await db.$transaction(async (tx) => {
    await tx.kycSubmission.update({
      where: { onboardingId },
      data: {
        status: nextStatus,
        reviewerId: user.id,
        decisionReason: decision === "REQUEST_CHANGES" ? reason : null,
        decidedAt: new Date(),
      },
    });
    await writeAuditEvent(tx, {
      actor: user,
      onboardingId,
      entityType: "KycSubmission",
      entityId: onboardingId,
      action: "UPDATE",
      oldValue: { status: onboarding.kyc!.status },
      newValue: { status: nextStatus, reason: decision === "REQUEST_CHANGES" ? reason : null },
      reference: `KYC ${decision === "ACCEPT" ? "accepted" : "changes requested"} by ${user.name}`,
    });
    return recomputeOnboardingStatus(tx, onboardingId);
  });

  if (decision === "REQUEST_CHANGES" && onboarding.franchisee.email) {
    await sendOnboardingEmail({
      key: "correction_request",
      to: onboarding.franchisee.email,
      onboardingId,
      vars: {
        name: onboarding.franchisee.name,
        store: `${onboarding.brand} ${onboarding.proposedLocation}`,
        reason,
        link: `${process.env.APP_URL || "http://localhost:3000"}/onboarding/documents`,
      },
    });
  }
  await notifyIfNewlyReadyForSignature(recompute, onboarding);

  revalidatePath("/reviews");
  return { success: true };
}

export async function decidePayment(
  onboardingId: string,
  _prevState: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  const user = await requireUser();
  if (!canReviewPayment(user)) {
    return { error: "You don't have permission to review payments." };
  }

  const decision = String(formData.get("decision") || "");
  const reason = String(formData.get("reason") || "");
  const reasonError = requireReasonIfRejecting(decision, reason);
  if (reasonError) return { error: reasonError };
  if (decision !== "ACCEPT" && decision !== "REQUEST_CHANGES") {
    return { error: "Invalid decision." };
  }

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId },
    include: {
      franchisee: true,
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const payment = onboarding?.payments[0];
  if (!onboarding || !payment) {
    return { error: "Onboarding not found." };
  }
  if (payment.status !== "SUBMITTED") {
    return { error: "This payment isn't awaiting review." };
  }
  // P1-05: the uploader cannot decide their own item.
  if (payment.uploadedById === user.id) {
    return { error: "You uploaded this receipt — another Accounts reviewer must decide it." };
  }

  let verifiedAmount: number | null = null;
  if (decision === "ACCEPT") {
    const verifiedAmountRupees = Number(formData.get("verifiedAmountRupees"));
    if (!verifiedAmountRupees || verifiedAmountRupees <= 0) {
      return { error: "Enter the verified amount to accept." };
    }
    verifiedAmount = Math.round(verifiedAmountRupees * 100);
  }
  const bankReference = String(formData.get("bankReference") || "").trim();

  const event = decision === "ACCEPT" ? "ACCEPT" : "REQUEST_CHANGES";
  const nextStatus = transitionReview(payment.status, event);

  const recompute = await db.$transaction(async (tx) => {
    await tx.paymentSubmission.update({
      where: { id: payment.id },
      data: {
        status: nextStatus,
        accountsActorId: user.id,
        decisionReason: decision === "REQUEST_CHANGES" ? reason : null,
        decidedAt: new Date(),
        verifiedAmount: decision === "ACCEPT" ? verifiedAmount : null,
        verifiedDate: decision === "ACCEPT" ? new Date() : null,
        bankReference: bankReference || null,
      },
    });
    await writeAuditEvent(tx, {
      actor: user,
      onboardingId,
      entityType: "PaymentSubmission",
      entityId: payment.id,
      action: "UPDATE",
      oldValue: { status: payment.status },
      newValue: { status: nextStatus, verifiedAmount, reason: decision === "REQUEST_CHANGES" ? reason : null },
      reference: `Payment ${decision === "ACCEPT" ? "accepted" : "changes requested"} by ${user.name}`,
    });
    return recomputeOnboardingStatus(tx, onboardingId);
  });

  if (onboarding.franchisee.email) {
    await sendOnboardingEmail({
      key: decision === "ACCEPT" ? "payment_accepted" : "payment_rejected",
      to: onboarding.franchisee.email,
      onboardingId,
      vars: {
        name: onboarding.franchisee.name,
        store: `${onboarding.brand} ${onboarding.proposedLocation}`,
        reason,
        link: `${process.env.APP_URL || "http://localhost:3000"}/onboarding/documents`,
      },
    });
  }
  await notifyIfNewlyReadyForSignature(recompute, onboarding);

  revalidatePath("/reviews");
  return { success: true };
}
