import { describe, it, expect, vi, beforeEach } from "vitest";

// webhook-processor.ts imports "server-only" — stub it for this unit test,
// same pattern as loi-pdf.test.ts.
vi.mock("server-only", () => ({}));

const mockTx = {
  esignAttempt: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  },
  esignEvent: { create: vi.fn() },
  auditEvent: { create: vi.fn() },
  loiVersion: { update: vi.fn() },
  user: { findMany: vi.fn().mockResolvedValue([]) },
};

const mockDb = {
  $transaction: vi.fn(async (cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
  esignAttempt: { findMany: vi.fn() },
  esignEvent: { create: vi.fn(), findUnique: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

const mockProvider = { getStatus: vi.fn(), fetchSignedPdf: vi.fn(), fetchCertificate: vi.fn() };
const getEsignProvider = vi.fn(() => mockProvider);
const currentProviderName = vi.fn(() => "leegality");
vi.mock("./index", () => ({ getEsignProvider, currentProviderName }));

const uploadDocument = vi.fn();
vi.mock("@/lib/storage", () => ({ uploadDocument }));

const sendOnboardingEmail = vi.fn();
vi.mock("@/lib/onboarding/notify", () => ({ sendOnboardingEmail }));

const convertOnboardingToProject = vi.fn().mockResolvedValue({ converted: false });
vi.mock("@/lib/onboarding/conversion", () => ({ convertOnboardingToProject }));

const recomputeOnboardingStatus = vi.fn();
vi.mock("@/lib/onboarding/recompute", () => ({ recomputeOnboardingStatus }));

const { processEsignEvent } = await import("./webhook-processor");
import type { ParsedWebhookEvent } from "./provider";

function franchiseeAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-franchisee",
    loiVersionId: "loi-1",
    signerRole: "FRANCHISEE",
    attemptNo: 1,
    status: "SENT",
    pdfSha256: "hash-a",
    providerEnvelopeId: "doc_1",
    providerSignUrl: "https://sign/franchisee",
    signerUser: { email: "franchisee@example.com" },
    loiVersion: {
      id: "loi-1",
      versionNo: "1.0",
      status: "SENT_FOR_SIGNING",
      onboardingId: "onb-1",
      signedPdfB2Key: null,
      signedPdfSha256: null,
      certificateB2Key: null,
      franchiseeSignedPdfB2Key: null,
      onboarding: {
        brand: "Fraterniti",
        proposedLocation: "Pune",
        franchisee: { name: "Franchisee Name", email: "franchisee@example.com" },
        salesOwner: { name: "Sales Owner", email: "sales@example.com" },
      },
    },
    ...overrides,
  };
}

function companyAttempt(overrides: Record<string, unknown> = {}) {
  return {
    ...franchiseeAttempt(),
    id: "attempt-company",
    signerRole: "COMPANY",
    providerSignUrl: "https://sign/company",
    signerUser: { email: "company@example.com" },
    ...overrides,
  };
}

function baseEvent(overrides: Partial<ParsedWebhookEvent> = {}): ParsedWebhookEvent {
  return {
    eventId: "provisional-id",
    envelopeId: "doc_1",
    status: "COMPLETED",
    invitationUrl: "https://sign/franchisee",
    inviteeEmail: "franchisee@example.com",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProviderName.mockReturnValue("leegality");
  getEsignProvider.mockReturnValue(mockProvider);
  mockDb.esignEvent.findUnique.mockResolvedValue(null);
  mockTx.esignAttempt.count.mockResolvedValue(0);
  mockTx.user.findMany.mockResolvedValue([]);
  convertOnboardingToProject.mockResolvedValue({ converted: false });
  mockProvider.fetchSignedPdf.mockResolvedValue(Buffer.from("signed-bytes"));
  mockProvider.fetchCertificate.mockResolvedValue(Buffer.from("certificate-bytes"));
});

describe("processEsignEvent — Leegality disambiguation + decision 6 confirmation", () => {
  it("resolves the right attempt by invitationUrl when two signers share one envelope", async () => {
    mockDb.esignAttempt.findMany.mockResolvedValue([franchiseeAttempt(), companyAttempt()]);
    mockProvider.getStatus.mockResolvedValue({ status: "SENT" });
    mockTx.esignAttempt.findUnique.mockResolvedValue(companyAttempt({ status: "SENT" }));

    await processEsignEvent(baseEvent({ invitationUrl: "https://sign/company", inviteeEmail: "company@example.com" }), true);

    expect(mockTx.esignAttempt.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "attempt-company" } })
    );
  });

  it("builds the leegality:<documentId>:<ROLE>:<kind> idempotency key", async () => {
    mockDb.esignAttempt.findMany.mockResolvedValue([franchiseeAttempt()]);
    mockProvider.getStatus.mockResolvedValue({ status: "COMPLETED" });
    mockTx.esignAttempt.findUnique.mockResolvedValue(franchiseeAttempt({ status: "SENT" }));

    await processEsignEvent(baseEvent(), true);

    expect(mockDb.esignEvent.findUnique).toHaveBeenCalledWith({
      where: { provider_providerEventId: { provider: "leegality", providerEventId: "leegality:doc_1:FRANCHISEE:signed" } },
    });
  });

  it("is a no-op on a duplicate webhook (dedup via the resolved idempotency key)", async () => {
    mockDb.esignAttempt.findMany.mockResolvedValue([franchiseeAttempt()]);
    mockProvider.getStatus.mockResolvedValue({ status: "COMPLETED" });
    mockDb.esignEvent.findUnique.mockResolvedValue({ id: "existing-event" });

    const result = await processEsignEvent(baseEvent(), true);

    expect(result.outcome).toBe("DUPLICATE");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("decision 6: a replayed webhook claiming COMPLETED changes nothing if the details API still says unsigned", async () => {
    mockDb.esignAttempt.findMany.mockResolvedValue([franchiseeAttempt()]);
    mockProvider.getStatus.mockResolvedValue({ status: "SENT" });
    mockTx.esignAttempt.findUnique.mockResolvedValue(franchiseeAttempt({ status: "SENT" }));

    const result = await processEsignEvent(baseEvent({ status: "COMPLETED" }), true);

    expect(result.outcome).toBe("PROCESSED");
    expect(mockTx.esignAttempt.update).not.toHaveBeenCalled();
  });

  it("records FAILED (no transaction opened) when no EsignAttempt matches the envelope", async () => {
    mockDb.esignAttempt.findMany.mockResolvedValue([]);

    const result = await processEsignEvent(baseEvent(), true);

    expect(result.outcome).toBe("FAILED");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.esignEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ error: expect.stringContaining("Unknown Leegality document") }) })
    );
  });

  it("never persists invitationUrl (a bearer secret) in the stored EsignEvent payload", async () => {
    mockDb.esignAttempt.findMany.mockResolvedValue([franchiseeAttempt()]);
    mockProvider.getStatus.mockResolvedValue({ status: "EXPIRED" });
    mockTx.esignAttempt.findUnique.mockResolvedValue(franchiseeAttempt({ status: "SENT" }));

    await processEsignEvent(baseEvent(), true);

    const call = mockTx.esignEvent.create.mock.calls.find((c) => c[0].data.processingStatus === "PROCESSED");
    expect(call).toBeDefined();
    expect(call![0].data.payload).not.toHaveProperty("invitationUrl");
  });

  it("expiry is handled through the normal transition, no special-casing needed", async () => {
    mockDb.esignAttempt.findMany.mockResolvedValue([franchiseeAttempt()]);
    mockProvider.getStatus.mockResolvedValue({ status: "EXPIRED" });
    mockTx.esignAttempt.findUnique.mockResolvedValue(franchiseeAttempt({ status: "SENT" }));

    const result = await processEsignEvent(baseEvent({ status: "EXPIRED" }), true);

    expect(result.outcome).toBe("PROCESSED");
    expect(mockTx.esignAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "EXPIRED" }) })
    );
  });
});

describe("processEsignEvent — rejection becomes LOI feedback", () => {
  it("turns a Rejected webhook into LoiFeedback audit + emails to preparer/sales/admin", async () => {
    mockDb.esignAttempt.findMany.mockResolvedValue([franchiseeAttempt()]);
    mockProvider.getStatus.mockResolvedValue({ status: "CANCELLED" });
    mockTx.esignAttempt.findUnique.mockResolvedValue(franchiseeAttempt({ status: "SENT" }));
    mockTx.user.findMany.mockResolvedValue([{ name: "Preparer", email: "prep@example.com", isActive: true }]);

    const result = await processEsignEvent(
      baseEvent({ status: "CANCELLED", rejectionMessage: "Fee looks wrong." }),
      true
    );

    expect(result.outcome).toBe("PROCESSED");
    expect(mockTx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityType: "LoiFeedback" }) })
    );
    expect(sendOnboardingEmail).toHaveBeenCalledWith(
      expect.objectContaining({ key: "loi_feedback", to: "prep@example.com" })
    );
    expect(sendOnboardingEmail).toHaveBeenCalledWith(
      expect.objectContaining({ key: "loi_feedback", to: "sales@example.com" })
    );
  });
});

describe("processEsignEvent — franchisee-completion backup (edge case 2)", () => {
  it("backs up the half-signed document into B2 the first time the franchisee completes", async () => {
    mockDb.esignAttempt.findMany.mockResolvedValue([franchiseeAttempt()]);
    mockProvider.getStatus.mockResolvedValue({ status: "COMPLETED" });
    mockTx.esignAttempt.findUnique.mockResolvedValue(franchiseeAttempt({ status: "SENT" }));
    mockProvider.fetchSignedPdf.mockResolvedValue(Buffer.from("half-signed-bytes"));

    await processEsignEvent(baseEvent({ status: "COMPLETED" }), true);

    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ key: "onboarding/onb-1/loi/1.0/franchisee-signed.pdf" })
    );
    expect(mockTx.loiVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ franchiseeSignedPdfB2Key: "onboarding/onb-1/loi/1.0/franchisee-signed.pdf" }),
      })
    );
  });

  it("does not back up again once a backup already exists", async () => {
    mockDb.esignAttempt.findMany.mockResolvedValue([franchiseeAttempt()]);
    mockProvider.getStatus.mockResolvedValue({ status: "COMPLETED" });
    mockTx.esignAttempt.findUnique.mockResolvedValue(
      franchiseeAttempt({
        status: "SENT",
        loiVersion: {
          ...franchiseeAttempt().loiVersion,
          franchiseeSignedPdfB2Key: "already-backed-up.pdf",
        },
      })
    );

    await processEsignEvent(baseEvent({ status: "COMPLETED" }), true);

    expect(uploadDocument).not.toHaveBeenCalled();
  });
});

describe("processEsignEvent — mock provider path is untouched by any of the above", () => {
  it("uses the webhook's own eventId directly and never calls getStatus or resolveLeegalityEvent", async () => {
    currentProviderName.mockReturnValue("mock");
    mockTx.esignAttempt.findFirst.mockResolvedValue(franchiseeAttempt({ status: "SENT" }));

    await processEsignEvent(baseEvent({ eventId: "mock-event-1" }), true);

    expect(mockProvider.getStatus).not.toHaveBeenCalled();
    expect(mockDb.esignAttempt.findMany).not.toHaveBeenCalled();
    expect(mockDb.esignEvent.findUnique).toHaveBeenCalledWith({
      where: { provider_providerEventId: { provider: "mock", providerEventId: "mock-event-1" } },
    });
  });
});
