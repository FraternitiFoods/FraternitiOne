import "server-only";

/**
 * plan.md section 17 "E-sign adapter (the tricky part)": provider-agnostic
 * interface — everything vendor-specific lives in src/lib/esign/. Nothing
 * outside this directory may know which vendor is configured; every call
 * site imports `getEsignProvider()` (index.ts), never a concrete provider
 * class directly.
 */
export type EsignSignerRole = "FRANCHISEE" | "COMPANY";

export type CreateEnvelopeInput = {
  attemptId: string;
  signer: { name: string; email: string; phone?: string; role: EsignSignerRole };
  pdf: Buffer;
  pdfSha256: string;
  authMode: "AADHAAR_ESIGN" | string;
};

export type EnvelopeStatus = "SENT" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "EXPIRED" | "CANCELLED";

export type ParsedWebhookEvent = {
  eventId: string;
  envelopeId: string;
  status: EnvelopeStatus;
  documentSha256?: string;
};

export interface EsignProvider {
  createEnvelope(input: CreateEnvelopeInput): Promise<{ envelopeId: string; signingUrl: string }>;
  getStatus(envelopeId: string): Promise<{ status: EnvelopeStatus; documentSha256?: string }>;
  voidEnvelope(envelopeId: string): Promise<void>;
  /** Throws if the signature is invalid — callers must never process an event whose signature didn't validate. */
  parseAndVerifyWebhook(rawBody: string, headers: Headers): Promise<ParsedWebhookEvent>;
  fetchSignedPdf(envelopeId: string): Promise<Buffer>;
  fetchCertificate(envelopeId: string): Promise<Buffer>;
}
