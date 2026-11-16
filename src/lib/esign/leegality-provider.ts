import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { EsignProvider, CreateEnvelopeInput, EnvelopeStatus, ParsedWebhookEvent } from "./provider";

/**
 * plan.md section 19 — the real vendor behind the `EsignProvider` interface
 * section 17 built for exactly this moment. Implements the "Leegality API
 * contract" table from plan.md section 19 against Leegality's v3 API with
 * the Legacy Auth Token (`X-Auth-Token`, not v4 OAuth). No real call has
 * been made against this yet (step L4 is explicitly "no real call yet") —
 * every method below is verified with a mocked `fetch` in
 * `leegality-provider.test.ts`; the one real end-to-end test is step L6,
 * human-gated and spending 2 real eSign credits.
 */

const REQUEST_TIMEOUT_MS = 15_000;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see .env.example.`);
  return value;
}

type LeegalityMessage = { code?: string; message: string };
type LeegalityEnvelope<T> = { status: 0 | 1; messages?: LeegalityMessage[]; data?: T };

/**
 * Every Leegality call: `X-Auth-Token` header, base URL from
 * `LEEGALITY_BASE_URL`, success = HTTP 2xx **and** `status === 1` (plan.md
 * section 19 "Leegality API contract"). 15-second timeout, no retry (edge
 * case 3: a retried create could spend credits twice). The thrown error
 * message is built only from Leegality's own `messages`/HTTP status — the
 * auth token is never interpolated into it, logged, or otherwise exposed.
 */
async function leegalityRequest<T>(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown }
): Promise<LeegalityEnvelope<T>> {
  const baseUrl = requiredEnv("LEEGALITY_BASE_URL").replace(/\/+$/, "");
  const token = requiredEnv("LEEGALITY_AUTH_TOKEN");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: { "X-Auth-Token": token, "Content-Type": "application/json" },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Leegality request timed out.");
    }
    throw new Error(err instanceof Error ? `Leegality request failed: ${err.message}` : "Leegality request failed.");
  } finally {
    clearTimeout(timer);
  }

  const json = (await response.json()) as LeegalityEnvelope<T>;
  if (!response.ok || json.status !== 1) {
    const detail = json.messages?.map((m) => m.message).join("; ");
    throw new Error(detail || `Leegality request failed (HTTP ${response.status}).`);
  }
  return json;
}

type CreateDocumentData = { documentId: string; invitees: { signUrl: string }[]; expiryDate?: string };
type DocumentDetailsData = {
  document: { status: string };
  invitations?: {
    invitationStatus?: { signed?: boolean; signDate?: string; failureReason?: string };
  }[];
};
type FetchDocumentData = { file: string };
type WalletBalanceData = { unused: number };

/**
 * Leegality's `document.status` values seen in the docs/webhook body are
 * `Draft` | `Sent` | `Completed` (plan.md section 19 "Webhook" body shape);
 * the details API's own status field is documented more loosely ("e.g.
 * `COMPLETED`" — plan.md's API contract table). Mapped conservatively;
 * anything unrecognized falls back to `SENT` rather than silently claiming
 * a terminal state the string didn't actually say. Reconcile against the
 * real details-API response once Apoorv's downloaded payload JSON is in
 * hand (L4's own "report any difference before L6").
 */
function mapLeegalityStatus(raw: string): EnvelopeStatus {
  switch (raw.toUpperCase()) {
    case "COMPLETED":
      return "COMPLETED";
    case "REJECTED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
    case "SENT":
    case "DRAFT":
      return "SENT";
    default:
      return "SENT";
  }
}

export class LeegalityProvider implements EsignProvider {
  async createEnvelope(input: CreateEnvelopeInput): Promise<{ envelopeId: string; signingUrl: string; coSigningUrl?: string }> {
    if (!input.coSigner) {
      throw new Error(
        "LeegalityProvider.createEnvelope needs both signers in one call (plan.md decision 4: one shared document, two invitees, fixed order) — pass `coSigner`."
      );
    }

    const profileId = requiredEnv("LEEGALITY_PROFILE_ID");
    const toInvitee = (s: NonNullable<CreateEnvelopeInput["signer"]>) => ({
      name: s.name,
      email: s.email,
      ...(s.phone ? { phone: s.phone } : {}),
    });

    const res = await leegalityRequest<CreateDocumentData>("/v3.0/sign/request", {
      method: "POST",
      body: {
        profileId,
        file: { name: "LOI.pdf", file: input.pdf.toString("base64") },
        invitees: [toInvitee(input.signer), toInvitee(input.coSigner)],
        irn: input.reference ?? input.attemptId,
      },
    });

    const documentId = res.data?.documentId;
    const invitees = res.data?.invitees;
    if (!documentId || !invitees || invitees.length < 2) {
      throw new Error("Leegality create-document response is missing documentId or both invitee signUrls.");
    }

    return { envelopeId: documentId, signingUrl: invitees[0].signUrl, coSigningUrl: invitees[1].signUrl };
  }

  async getStatus(envelopeId: string): Promise<{ status: EnvelopeStatus; documentSha256?: string }> {
    const res = await leegalityRequest<DocumentDetailsData>(
      `/v3.3/document/details?documentId=${encodeURIComponent(envelopeId)}`,
      { method: "GET" }
    );
    const rawStatus = res.data?.document.status;
    if (!rawStatus) throw new Error("Leegality document-details response is missing document.status.");
    // Leegality never returns a hash of the document we uploaded (plan.md
    // section 19 "Integrity") — documentSha256 is intentionally omitted.
    return { status: mapLeegalityStatus(rawStatus) };
  }

  async voidEnvelope(envelopeId: string): Promise<void> {
    // "Permanently deletes a document and all associated data" (plan.md
    // section 19 API contract) — downloading whatever signed bytes/audit
    // trail exist first is the *caller's* job (edge cases 1-2), not this
    // method's; it does exactly what its name says, nothing more.
    await leegalityRequest<Record<string, never>>(`/v3.0/sign/request?documentId=${encodeURIComponent(envelopeId)}`, {
      method: "DELETE",
    });
  }

  /**
   * Verifies `mac` only — decision 6: "the webhook is a doorbell, not
   * proof." The caller (`processEsignEvent`) must still call `getStatus`
   * and act only on that answer; this method never claims otherwise.
   */
  async parseAndVerifyWebhook(rawBody: string): Promise<ParsedWebhookEvent> {
    let payload: {
      documentId?: string;
      documentStatus?: "Draft" | "Sent" | "Completed";
      mac?: string;
      request?: {
        invitationUrl?: string;
        email?: string;
        action?: "Signed" | "Rejected" | null;
        expired?: boolean;
        rejectionMessage?: string;
      };
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error("Invalid webhook body — not JSON.");
    }

    const { documentId, mac } = payload;
    if (!documentId || !mac) throw new Error("Webhook payload is missing documentId or mac.");

    const privateSalt = requiredEnv("LEEGALITY_PRIVATE_SALT");
    const expectedMac = createHmac("sha1", privateSalt).update(documentId).digest("hex");
    const given = Buffer.from(mac.toLowerCase());
    const expected = Buffer.from(expectedMac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new Error("Invalid webhook signature.");
    }

    let status: EnvelopeStatus = mapLeegalityStatus(payload.documentStatus ?? "Sent");
    if (payload.request?.action === "Rejected") status = "CANCELLED";
    if (payload.request?.expired) status = "EXPIRED";

    return {
      // Leegality sends no event id (plan.md "Idempotency key"): the final
      // `leegality:<documentId>:<FRANCHISEE|COMPANY>:<event>` key needs the
      // signer role, which requires matching invitationUrl/email against a
      // stored attempt — a DB lookup this provider-layer method deliberately
      // doesn't do. Step L5 (webhook-processor.ts) builds the real key once
      // it has that match; this provisional id is only unique enough for
      // this step's own unit tests, not meant to be the final idempotency key.
      eventId: `leegality:${documentId}:${payload.request?.invitationUrl ?? payload.request?.email ?? "unknown"}:${status}`,
      envelopeId: documentId,
      status,
      invitationUrl: payload.request?.invitationUrl,
      inviteeEmail: payload.request?.email,
      rejectionMessage: payload.request?.action === "Rejected" ? payload.request?.rejectionMessage : undefined,
    };
  }

  async fetchSignedPdf(envelopeId: string): Promise<Buffer> {
    return this.downloadDocumentFile(envelopeId, "DOCUMENT");
  }

  async fetchCertificate(envelopeId: string): Promise<Buffer> {
    return this.downloadDocumentFile(envelopeId, "AUDIT_TRAIL");
  }

  /** The returned CDN URL expires in 15 seconds (plan.md API contract) — fetched immediately, never stored or logged. */
  private async downloadDocumentFile(envelopeId: string, type: "DOCUMENT" | "AUDIT_TRAIL"): Promise<Buffer> {
    const res = await leegalityRequest<FetchDocumentData>(
      `/v3.3/document/fetchDocument?documentId=${encodeURIComponent(envelopeId)}&documentDownloadType=${type}`,
      { method: "GET" }
    );
    const fileUrl = res.data?.file;
    if (!fileUrl) throw new Error("Leegality fetchDocument response is missing the file URL.");

    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error(`Failed to download Leegality ${type === "DOCUMENT" ? "signed document" : "audit trail"} (HTTP ${fileRes.status}).`);
    return Buffer.from(await fileRes.arrayBuffer());
  }
}

let cachedWalletBalance: { value: number; fetchedAt: number } | null = null;
const WALLET_CACHE_MS = 5 * 60 * 1000;

/**
 * plan.md section 19 API contract "(new, small) wallet line" — cached 5
 * minutes, failure ignored, never blocks signing. Returns `null` on any
 * failure (missing env vars, network error, non-2xx) rather than throwing,
 * since nothing calling this may ever let a wallet-balance check block a
 * real signing flow.
 */
export async function getLeegalityWalletBalance(): Promise<number | null> {
  const now = Date.now();
  if (cachedWalletBalance && now - cachedWalletBalance.fetchedAt < WALLET_CACHE_MS) {
    return cachedWalletBalance.value;
  }
  try {
    const res = await leegalityRequest<WalletBalanceData>("/v3.0/wallet/balance/details", { method: "GET" });
    const unused = res.data?.unused;
    if (typeof unused !== "number") return null;
    cachedWalletBalance = { value: unused, fetchedAt: now };
    return unused;
  } catch {
    return null;
  }
}
