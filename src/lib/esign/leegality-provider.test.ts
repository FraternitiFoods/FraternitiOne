import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

// leegality-provider.ts imports "server-only" — see the matching comment in
// loi-pdf.test.ts for why this needs stubbing under Vitest.
vi.mock("server-only", () => ({}));

const { LeegalityProvider, getLeegalityWalletBalance } = await import("./leegality-provider");

const ENV = {
  LEEGALITY_BASE_URL: "https://sandbox.leegality.com/api",
  LEEGALITY_AUTH_TOKEN: "test-token-should-never-leak",
  LEEGALITY_PRIVATE_SALT: "test-salt-should-never-leak",
  LEEGALITY_PROFILE_ID: "profile-123",
};

function setEnv() {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
}
function clearEnv() {
  for (const k of Object.keys(ENV)) delete process.env[k];
}

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  const status = init?.status ?? 200;
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const FRANCHISEE = { name: "Franchisee Name", email: "f@example.com", role: "FRANCHISEE" as const };
const COMPANY = { name: "Company Signatory", email: "c@example.com", role: "COMPANY" as const };

beforeEach(() => {
  setEnv();
});

afterEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LeegalityProvider.createEnvelope", () => {
  it("throws without a coSigner — decision 4 requires one shared document, two invitees", async () => {
    const provider = new LeegalityProvider();
    await expect(
      provider.createEnvelope({
        attemptId: "attempt_1",
        signer: FRANCHISEE,
        pdf: Buffer.from("pdf"),
        pdfSha256: "hash",
        authMode: "AADHAAR_ESIGN",
      })
    ).rejects.toThrow(/coSigner/);
  });

  it("sends the exact URL, headers and body, and parses both signUrls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 1,
        data: { documentId: "doc_1", invitees: [{ signUrl: "https://sign/1" }, { signUrl: "https://sign/2" }] },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new LeegalityProvider();
    const result = await provider.createEnvelope({
      attemptId: "attempt_1",
      signer: FRANCHISEE,
      coSigner: COMPANY,
      pdf: Buffer.from("pdf-bytes"),
      pdfSha256: "hash",
      authMode: "AADHAAR_ESIGN",
    });

    expect(result).toEqual({ envelopeId: "doc_1", signingUrl: "https://sign/1", coSigningUrl: "https://sign/2" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.leegality.com/api/v3.0/sign/request");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "X-Auth-Token": ENV.LEEGALITY_AUTH_TOKEN,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      profileId: ENV.LEEGALITY_PROFILE_ID,
      file: { name: "LOI.pdf", file: Buffer.from("pdf-bytes").toString("base64") },
      invitees: [
        { name: "Franchisee Name", email: "f@example.com" },
        { name: "Company Signatory", email: "c@example.com" },
      ],
      irn: "attempt_1",
    });
  });

  it("includes phone when given, and uses `reference` over attemptId for irn", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 1,
        data: { documentId: "doc_1", invitees: [{ signUrl: "https://sign/1" }, { signUrl: "https://sign/2" }] },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new LeegalityProvider();
    await provider.createEnvelope({
      attemptId: "attempt_1",
      reference: "loiVersion_1",
      signer: { ...FRANCHISEE, phone: "9876543210" },
      coSigner: COMPANY,
      pdf: Buffer.from("x"),
      pdfSha256: "h",
      authMode: "AADHAAR_ESIGN",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.invitees[0]).toEqual({ name: "Franchisee Name", email: "f@example.com", phone: "9876543210" });
    expect(body.irn).toBe("loiVersion_1");
  });

  it("fails on status: 0 with Leegality's messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: 0, messages: [{ message: "Invalid profileId" }] }))
    );
    const provider = new LeegalityProvider();
    await expect(
      provider.createEnvelope({
        attemptId: "a1",
        signer: FRANCHISEE,
        coSigner: COMPANY,
        pdf: Buffer.from("x"),
        pdfSha256: "h",
        authMode: "AADHAAR_ESIGN",
      })
    ).rejects.toThrow("Invalid profileId");
  });

  it("fails on non-2xx even when the body claims status: 1", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: 1, data: {} }, { status: 500 })));
    const provider = new LeegalityProvider();
    await expect(
      provider.createEnvelope({
        attemptId: "a1",
        signer: FRANCHISEE,
        coSigner: COMPANY,
        pdf: Buffer.from("x"),
        pdfSha256: "h",
        authMode: "AADHAAR_ESIGN",
      })
    ).rejects.toThrow(/HTTP 500/);
  });

  it("times out after 15s with no retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new LeegalityProvider();
    const promise = provider.createEnvelope({
      attemptId: "a1",
      signer: FRANCHISEE,
      coSigner: COMPANY,
      pdf: Buffer.from("x"),
      pdfSha256: "h",
      authMode: "AADHAAR_ESIGN",
    });
    const assertion = expect(promise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never leaks the auth token or private salt into a thrown error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: 0, messages: [{ message: "nope" }] })));
    const provider = new LeegalityProvider();
    await expect(
      provider.createEnvelope({
        attemptId: "a1",
        signer: FRANCHISEE,
        coSigner: COMPANY,
        pdf: Buffer.from("x"),
        pdfSha256: "h",
        authMode: "AADHAAR_ESIGN",
      })
    ).rejects.toSatisfy((err: unknown) => {
      const message = String(err);
      return !message.includes(ENV.LEEGALITY_AUTH_TOKEN) && !message.includes(ENV.LEEGALITY_PRIVATE_SALT);
    });
  });
});

describe("LeegalityProvider.getStatus", () => {
  it("sends a GET with the documentId query param", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 1, data: { document: { status: "Completed" } } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new LeegalityProvider();
    const result = await provider.getStatus("doc_1");
    expect(result).toEqual({ status: "COMPLETED" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.leegality.com/api/v3.3/document/details?documentId=doc_1");
    expect(init.method).toBe("GET");
  });

  it.each([
    ["Draft", "SENT"],
    ["Sent", "SENT"],
    ["Completed", "COMPLETED"],
  ])("maps document.status %s to %s", async (raw, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: 1, data: { document: { status: raw } } })));
    const provider = new LeegalityProvider();
    expect((await provider.getStatus("doc_1")).status).toBe(expected);
  });

  it("never returns a documentSha256 — Leegality doesn't provide one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: 1, data: { document: { status: "Completed" } } }))
    );
    const provider = new LeegalityProvider();
    expect((await provider.getStatus("doc_1")).documentSha256).toBeUndefined();
  });
});

describe("LeegalityProvider.voidEnvelope", () => {
  it("sends a DELETE with the documentId query param", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new LeegalityProvider();
    await provider.voidEnvelope("doc_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.leegality.com/api/v3.0/sign/request?documentId=doc_1");
    expect(init.method).toBe("DELETE");
  });
});

describe("LeegalityProvider.fetchSignedPdf / fetchCertificate", () => {
  it("downloads the 15-second CDN URL immediately after the fetchDocument call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 1, data: { file: "https://cdn.example/signed.pdf" } }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        // Not Buffer.from(string).buffer — Node pools small Buffer
        // allocations, so `.buffer` can expose its whole shared pool
        // (unrelated memory) rather than a tightly-sized ArrayBuffer.
        // TextEncoder's output isn't pooled, matching what a real
        // Response.arrayBuffer() actually returns.
        arrayBuffer: async () => new TextEncoder().encode("signed-bytes").buffer,
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const provider = new LeegalityProvider();
    const result = await provider.fetchSignedPdf("doc_1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("documentDownloadType=DOCUMENT");
    expect(fetchMock.mock.calls[1][0]).toBe("https://cdn.example/signed.pdf");
    expect(Buffer.from(result).toString()).toBe("signed-bytes");
  });

  it("fetchCertificate requests documentDownloadType=AUDIT_TRAIL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 1, data: { file: "https://cdn.example/audit.pdf" } }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("audit-bytes").buffer,
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const provider = new LeegalityProvider();
    const result = await provider.fetchCertificate("doc_1");
    expect(String(fetchMock.mock.calls[0][0])).toContain("documentDownloadType=AUDIT_TRAIL");
    expect(Buffer.from(result).toString()).toBe("audit-bytes");
  });
});

describe("LeegalityProvider.parseAndVerifyWebhook", () => {
  function fixture(documentId: string, overrides: Record<string, unknown> = {}) {
    const mac = createHmac("sha1", ENV.LEEGALITY_PRIVATE_SALT).update(documentId).digest("hex");
    return JSON.stringify({
      documentId,
      documentStatus: "Completed",
      mac,
      request: { email: "f@example.com", invitationUrl: "https://sign/1" },
      ...overrides,
    });
  }

  it("accepts a correctly-signed payload and reports the invitee for L5's own matching", async () => {
    const provider = new LeegalityProvider();
    const result = await provider.parseAndVerifyWebhook(fixture("doc_1"));
    expect(result.envelopeId).toBe("doc_1");
    expect(result.status).toBe("COMPLETED");
    expect(result.inviteeEmail).toBe("f@example.com");
    expect(result.invitationUrl).toBe("https://sign/1");
  });

  it("rejects a wrong mac", async () => {
    const provider = new LeegalityProvider();
    const body = JSON.parse(fixture("doc_1"));
    body.mac = "0".repeat(40);
    await expect(provider.parseAndVerifyWebhook(JSON.stringify(body))).rejects.toThrow("Invalid webhook signature.");
  });

  it("rejects a missing mac", async () => {
    const provider = new LeegalityProvider();
    const body = JSON.parse(fixture("doc_1"));
    delete body.mac;
    await expect(provider.parseAndVerifyWebhook(JSON.stringify(body))).rejects.toThrow(/missing documentId or mac/);
  });

  it("maps a rejected signature to CANCELLED", async () => {
    const provider = new LeegalityProvider();
    const result = await provider.parseAndVerifyWebhook(
      fixture("doc_1", { request: { action: "Rejected", email: "f@example.com" } })
    );
    expect(result.status).toBe("CANCELLED");
  });

  it("maps an expired link to EXPIRED", async () => {
    const provider = new LeegalityProvider();
    const result = await provider.parseAndVerifyWebhook(
      fixture("doc_1", { request: { expired: true, email: "f@example.com" } })
    );
    expect(result.status).toBe("EXPIRED");
  });
});

describe("getLeegalityWalletBalance", () => {
  it("returns null (never throws) when the call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await getLeegalityWalletBalance()).toBeNull();
  });

  it("returns the unused credit count and serves the second call from a 5-minute cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 1, data: { unused: 42 } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getLeegalityWalletBalance()).toBe(42);
    expect(await getLeegalityWalletBalance()).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
