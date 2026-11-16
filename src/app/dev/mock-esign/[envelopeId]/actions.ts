"use server";

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { signMockPayload } from "@/lib/esign/mock-provider";

export type MockWebhookResult = { error?: string; success?: boolean; eventId?: string };

/**
 * plan.md section 17: fires a real HMAC-signed webhook at our own
 * /api/webhooks/esign route — the same code path a real vendor would hit —
 * so the dev signing page exercises the actual webhook processing, not a
 * shortcut. Defense in depth: refuses outside dev even though
 * getEsignProvider() already makes it impossible for a mock envelope to
 * exist in production in the first place.
 */
export async function triggerMockWebhook(
  envelopeId: string,
  status: "COMPLETED" | "FAILED" | "EXPIRED",
  options?: { duplicateOfEventId?: string }
): Promise<MockWebhookResult> {
  if (process.env.NODE_ENV === "production" || process.env.ESIGN_PROVIDER !== "mock") {
    return { error: "Mock e-sign is not available in this environment." };
  }

  const attempt = await db.esignAttempt.findFirst({ where: { providerEnvelopeId: envelopeId } });
  if (!attempt) return { error: "Unknown envelope." };

  const payload = {
    eventId: options?.duplicateOfEventId ?? randomUUID(),
    envelopeId,
    status,
    documentSha256: status === "COMPLETED" ? attempt.pdfSha256 : undefined,
  };
  const rawBody = JSON.stringify(payload);
  const signature = signMockPayload(rawBody);

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const res = await fetch(`${appUrl}/api/webhooks/esign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mock-esign-signature": signature },
    body: rawBody,
  });
  if (!res.ok) {
    return { error: `Webhook call failed (${res.status}).` };
  }
  return { success: true, eventId: payload.eventId };
}
