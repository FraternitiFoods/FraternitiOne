import { describe, expect, it } from "vitest";
import { computeOnboardingCompletion, type CompletionInput } from "./completion";

function baseInput(overrides: Partial<CompletionInput> = {}): CompletionInput {
  return {
    entityType: "INDIVIDUAL",
    kyc: null,
    uploadedFileKinds: [],
    paymentStatus: "MISSING",
    ...overrides,
  };
}

describe("computeOnboardingCompletion", () => {
  it("INDIVIDUAL with nothing submitted: 0 of 7, every item not done", () => {
    const result = computeOnboardingCompletion(baseInput());
    expect(result.total).toBe(7);
    expect(result.completed).toBe(0);
    expect(result.items.every((i) => !i.done)).toBe(true);
  });

  it("INDIVIDUAL does not include COMPANY-only fields", () => {
    const result = computeOnboardingCompletion(baseInput());
    const keys = result.items.map((i) => i.key);
    expect(keys).not.toContain("company_name");
    expect(keys).not.toContain("company_pan");
    expect(keys).not.toContain("authorised_signatory");
    expect(keys).toContain("aadhaar_holder_name");
    expect(keys).toContain("aadhaar_last4");
  });

  it("COMPANY with nothing submitted: 0 of 10, no INDIVIDUAL-only fields", () => {
    const result = computeOnboardingCompletion(baseInput({ entityType: "COMPANY" }));
    expect(result.total).toBe(10);
    expect(result.completed).toBe(0);
    const keys = result.items.map((i) => i.key);
    expect(keys).not.toContain("aadhaar_holder_name");
    expect(keys).not.toContain("aadhaar_last4");
    expect(keys).toContain("company_name");
    expect(keys).toContain("company_pan");
    expect(keys).toContain("authorised_signatory");
  });

  it("counts partial KYC fields correctly for INDIVIDUAL", () => {
    const result = computeOnboardingCompletion(
      baseInput({
        kyc: {
          panNumberEncrypted: "enc",
          panName: "Jane Doe",
          aadhaarHolderName: null,
          aadhaarLast4: null,
          companyName: null,
          companyPan: null,
          authorisedSignatoryName: null,
        },
      })
    );
    expect(result.completed).toBe(2);
    expect(result.items.find((i) => i.key === "pan_number")?.done).toBe(true);
    expect(result.items.find((i) => i.key === "aadhaar_last4")?.done).toBe(false);
  });

  it("counts only required document kinds, ignoring unrelated uploaded kinds", () => {
    const result = computeOnboardingCompletion(
      baseInput({ uploadedFileKinds: ["PAN", "PHOTOGRAPH"] })
    );
    // PAN is required for INDIVIDUAL and was uploaded; PHOTOGRAPH is optional
    // (20C) and not part of requiredKycFileKinds, so it contributes nothing.
    expect(result.items.find((i) => i.key === "doc_PAN")?.done).toBe(true);
    expect(result.items.some((i) => i.key === "doc_PHOTOGRAPH")).toBe(false);
    expect(result.completed).toBe(1);
  });

  it("payment proof counts as done once paymentStatus leaves MISSING", () => {
    const missing = computeOnboardingCompletion(baseInput({ paymentStatus: "MISSING" }));
    const submitted = computeOnboardingCompletion(baseInput({ paymentStatus: "SUBMITTED" }));
    expect(missing.items.find((i) => i.key === "payment_proof")?.done).toBe(false);
    expect(submitted.items.find((i) => i.key === "payment_proof")?.done).toBe(true);
  });

  it("INDIVIDUAL fully complete: 7 of 7", () => {
    const result = computeOnboardingCompletion(
      baseInput({
        kyc: {
          panNumberEncrypted: "enc",
          panName: "Jane Doe",
          aadhaarHolderName: "Jane Doe",
          aadhaarLast4: "1234",
          companyName: null,
          companyPan: null,
          authorisedSignatoryName: null,
        },
        uploadedFileKinds: ["PAN", "AADHAAR"],
        paymentStatus: "ACCEPTED",
      })
    );
    expect(result.completed).toBe(7);
    expect(result.total).toBe(7);
  });

  it("COMPANY fully complete: 10 of 10", () => {
    const result = computeOnboardingCompletion(
      baseInput({
        entityType: "COMPANY",
        kyc: {
          panNumberEncrypted: "enc",
          panName: "Signatory Name",
          aadhaarHolderName: null,
          aadhaarLast4: null,
          companyName: "Acme Pvt Ltd",
          companyPan: "ABCDE1234F",
          authorisedSignatoryName: "Signatory Name",
        },
        uploadedFileKinds: ["PAN", "AADHAAR", "COMPANY_DOC", "SIGNATORY_PROOF"],
        paymentStatus: "SUBMITTED",
      })
    );
    expect(result.completed).toBe(10);
    expect(result.total).toBe(10);
  });
});
