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
  /**
   * plan.md section 19 decision 4: Leegality wants ONE document with BOTH
   * invitees in a single `POST /v3.0/sign/request` (fixed order: FRANCHISEE
   * invitee 1, COMPANY invitee 2), returning a signUrl for each — not one
   * document per signer. Passing this lets a provider that supports that
   * shared-document model create it and hand back the second signer's link
   * too (`coSigningUrl` below); a provider without it (the mock provider, and
   * every real call site today) just ignores it. `LeegalityProvider` (step
   * L4) *requires* it and throws without it, since a single-invitee document
   * would violate decision 4. Wiring `startFranchiseeEsign`/
   * `startCompanyEsign` to actually pass this and share the resulting
   * document between two `EsignAttempt` rows — and the webhook-matching
   * change that then requires, since `providerEnvelopeId` stops being
   * 1:1 with an attempt — is step L5, not this interface-level change.
   */
  coSigner?: { name: string; email: string; phone?: string; role: EsignSignerRole };
  /** Provider-specific reference string (Leegality's `irn`); defaults to `attemptId` if omitted. */
  reference?: string;
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
  /**
   * plan.md section 19 webhook rules: Leegality sends no event id and no
   * per-invitee attempt id — the caller must match `invitationUrl` (fallback:
   * `inviteeEmail`) against the `signUrl` stored on each attempt to know
   * which of the two signers (under decision 4's shared document) this event
   * is about. Undefined for providers where `envelopeId` is already 1:1 with
   * one attempt (the mock provider). Actually using these to disambiguate in
   * `webhook-processor.ts` is step L5.
   */
  invitationUrl?: string;
  inviteeEmail?: string;
};

export interface EsignProvider {
  createEnvelope(input: CreateEnvelopeInput): Promise<{
    envelopeId: string;
    signingUrl: string;
    /** Only present when `coSigner` was passed and the provider created one shared document for both signers (decision 4). */
    coSigningUrl?: string;
  }>;
  getStatus(envelopeId: string): Promise<{ status: EnvelopeStatus; documentSha256?: string }>;
  voidEnvelope(envelopeId: string): Promise<void>;
  /** Throws if the signature is invalid — callers must never process an event whose signature didn't validate. */
  parseAndVerifyWebhook(rawBody: string, headers: Headers): Promise<ParsedWebhookEvent>;
  fetchSignedPdf(envelopeId: string): Promise<Buffer>;
  fetchCertificate(envelopeId: string): Promise<Buffer>;
}
