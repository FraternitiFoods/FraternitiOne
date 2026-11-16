import "server-only";

import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { db } from "@/lib/db";
import { getObjectBuffer } from "@/lib/storage";
import type { EsignProvider, CreateEnvelopeInput, EnvelopeStatus, ParsedWebhookEvent } from "./provider";

/**
 * plan.md section 17: exercises the whole flow locally. Serves a fake
 * signing page at /dev/mock-esign/[envelopeId] (Complete/Fail/Expire
 * buttons) that POSTs an HMAC-signed webhook to our own real webhook route
 * — the webhook code path is the same one a real vendor would hit.
 *
 * Safety: `getEsignProvider()` (index.ts) refuses to hand back this class at
 * all when NODE_ENV=production. Every signed PDF/certificate this class
 * produces is watermarked "TEST SIGNATURE" and must never be treated as
 * production sign-off (plan.md section 17's own words).
 */

function webhookSecret(): string {
  const secret = process.env.ESIGN_WEBHOOK_SECRET;
  if (!secret) throw new Error("ESIGN_WEBHOOK_SECRET is not set — see .env.example.");
  return secret;
}

export function signMockPayload(rawBody: string): string {
  return createHmac("sha256", webhookSecret()).update(rawBody).digest("hex");
}

function mapAttemptStatusToEnvelopeStatus(status: string): EnvelopeStatus {
  switch (status) {
    case "COMPLETED":
    case "FAILED":
    case "EXPIRED":
    case "CANCELLED":
    case "IN_PROGRESS":
      return status;
    default:
      return "SENT";
  }
}

export class MockProvider implements EsignProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createEnvelope(_input: CreateEnvelopeInput): Promise<{ envelopeId: string; signingUrl: string }> {
    const envelopeId = `mock_${randomUUID()}`;
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    return { envelopeId, signingUrl: `${appUrl}/dev/mock-esign/${envelopeId}` };
  }

  async getStatus(envelopeId: string): Promise<{ status: EnvelopeStatus; documentSha256?: string }> {
    const attempt = await db.esignAttempt.findFirst({ where: { providerEnvelopeId: envelopeId } });
    if (!attempt) throw new Error("Unknown envelope.");
    return {
      status: mapAttemptStatusToEnvelopeStatus(attempt.status),
      documentSha256: attempt.status === "COMPLETED" ? attempt.pdfSha256 : undefined,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async voidEnvelope(_envelopeId: string): Promise<void> {
    // No external service to notify — the DB-side VOID transition
    // (transitionLoiVersion / transitionEsignAttempt) is the real effect.
  }

  async parseAndVerifyWebhook(rawBody: string, headers: Headers): Promise<ParsedWebhookEvent> {
    const signature = headers.get("x-mock-esign-signature");
    if (!signature) throw new Error("Missing signature header.");
    const expected = signMockPayload(rawBody);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Invalid webhook signature.");
    }
    const payload = JSON.parse(rawBody) as {
      eventId: string;
      envelopeId: string;
      status: EnvelopeStatus;
      documentSha256?: string;
    };
    return payload;
  }

  async fetchSignedPdf(envelopeId: string): Promise<Buffer> {
    const attempt = await db.esignAttempt.findFirstOrThrow({
      where: { providerEnvelopeId: envelopeId },
      include: { loiVersion: true },
    });
    const original = await getObjectBuffer(attempt.loiVersion.pdfB2Key);
    const doc = await PDFDocument.load(original);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const page of doc.getPages()) {
      const { height } = page.getSize();
      page.drawText("TEST SIGNATURE — MOCK E-SIGN, NOT LEGALLY BINDING", {
        x: 20,
        y: height / 2,
        size: 18,
        font,
        color: rgb(0.85, 0, 0),
        rotate: degrees(45),
        opacity: 0.5,
      });
    }
    return Buffer.from(await doc.save());
  }

  async fetchCertificate(envelopeId: string): Promise<Buffer> {
    const attempt = await db.esignAttempt.findFirstOrThrow({ where: { providerEnvelopeId: envelopeId } });
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([595, 400]);
    page.drawText("MOCK SIGNING CERTIFICATE — NOT LEGALLY VALID", { x: 40, y: 350, size: 14, font: bold, color: rgb(0.85, 0, 0) });
    page.drawText(`Envelope: ${envelopeId}`, { x: 40, y: 310, size: 11, font });
    page.drawText(`Signer role: ${attempt.signerRole}`, { x: 40, y: 290, size: 11, font });
    page.drawText(`Document SHA-256: ${attempt.pdfSha256}`, { x: 40, y: 270, size: 9, font });
    page.drawText(`Completed at: ${attempt.completedAt?.toISOString() ?? "-"}`, { x: 40, y: 250, size: 11, font });
    return Buffer.from(await doc.save());
  }
}
