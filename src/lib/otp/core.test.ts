import { describe, expect, it } from "vitest";
import {
  generateOtpCode,
  hashOtpCode,
  evaluateOtpVerify,
  evaluateOtpSend,
  shouldSupersedeOnResend,
  type OtpChallengeSnapshot,
} from "./core";
import { OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_MAX_SENDS_PER_WINDOW, OTP_RESEND_COOLDOWN_SECONDS } from "./limits";

const SECRET = "test-secret";
const NOW = new Date("2026-10-01T10:00:00.000Z");
const NOT_EXPIRED = new Date("2026-10-01T10:05:00.000Z"); // 5 min after issue, within 10-min TTL
const AFTER_EXPIRY = new Date("2026-10-01T10:11:00.000Z"); // 11 min after issue

function baseChallenge(overrides: Partial<OtpChallengeSnapshot> = {}): OtpChallengeSnapshot {
  const id = "challenge_1";
  const code = "123456";
  return {
    id,
    status: "PENDING",
    expiresAt: new Date("2026-10-01T10:10:00.000Z"),
    attempts: 0,
    codeHash: hashOtpCode(SECRET, id, code),
    loiVersionId: "loi_1",
    pdfSha256: "hash_1",
    ...overrides,
  };
}

const BASE_INPUT = {
  now: NOT_EXPIRED,
  secret: SECRET,
  currentLoiVersionId: "loi_1",
  currentPdfSha256: "hash_1",
};

describe("generateOtpCode", () => {
  it(`produces a ${OTP_LENGTH}-digit numeric string, zero-padded`, () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(new RegExp(`^\\d{${OTP_LENGTH}}$`));
    }
  });
});

describe("evaluateOtpVerify", () => {
  it("correct code passes", () => {
    const challenge = baseChallenge();
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, code: "123456" });
    expect(outcome).toEqual({ result: "VERIFIED" });
  });

  it("wrong code counts as an attempt without locking before the limit", () => {
    const challenge = baseChallenge({ attempts: 0 });
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, code: "000000" });
    expect(outcome).toEqual({ result: "WRONG_CODE", attempts: 1, locked: false });
  });

  it(`the ${OTP_MAX_ATTEMPTS}th wrong attempt locks the challenge`, () => {
    const challenge = baseChallenge({ attempts: OTP_MAX_ATTEMPTS - 1 });
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, code: "000000" });
    expect(outcome).toEqual({ result: "WRONG_CODE", attempts: OTP_MAX_ATTEMPTS, locked: true });
  });

  it("an already-LOCKED challenge rejects any further attempt, even the correct code", () => {
    const challenge = baseChallenge({ status: "LOCKED", attempts: OTP_MAX_ATTEMPTS });
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, code: "123456" });
    expect(outcome).toEqual({ result: "LOCKED" });
  });

  it("an expired challenge fails even with the correct code", () => {
    const challenge = baseChallenge();
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, now: AFTER_EXPIRY, code: "123456" });
    expect(outcome).toEqual({ result: "EXPIRED" });
  });

  it("a challenge already marked EXPIRED fails regardless of the clock", () => {
    const challenge = baseChallenge({ status: "EXPIRED" });
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, code: "123456" });
    expect(outcome).toEqual({ result: "EXPIRED" });
  });

  it("a VERIFIED challenge can never be reused (replay)", () => {
    const challenge = baseChallenge({ status: "VERIFIED" });
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, code: "123456" });
    expect(outcome).toEqual({ result: "ALREADY_USED" });
  });

  it("a SUPERSEDED challenge (old OTP after a resend) is rejected", () => {
    const challenge = baseChallenge({ status: "SUPERSEDED" });
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, code: "123456" });
    expect(outcome).toEqual({ result: "ALREADY_USED" });
  });

  it("fails when a newer LOI version has been released since the OTP was sent", () => {
    const challenge = baseChallenge({ loiVersionId: "loi_1" });
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, code: "123456", currentLoiVersionId: "loi_2" });
    expect(outcome).toEqual({ result: "VERSION_MISMATCH" });
  });

  it("fails when the LOI hash has changed since the OTP was sent", () => {
    const challenge = baseChallenge({ pdfSha256: "hash_1" });
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, code: "123456", currentPdfSha256: "hash_2" });
    expect(outcome).toEqual({ result: "VERSION_MISMATCH" });
  });

  it("version mismatch is checked even for an otherwise-correct code, and the outcome carries no attempts count for the caller to persist", () => {
    const challenge = baseChallenge({ pdfSha256: "hash_1", attempts: 2 });
    const outcome = evaluateOtpVerify(challenge, { ...BASE_INPUT, code: "123456", currentPdfSha256: "hash_2" });
    expect(outcome).toEqual({ result: "VERSION_MISMATCH" });
    expect(outcome).not.toHaveProperty("attempts");
  });
});

describe("evaluateOtpSend", () => {
  it("allows the first send (no prior send, no window usage)", () => {
    const outcome = evaluateOtpSend({ lastSentAt: null, sendsInWindow: 0, now: NOW });
    expect(outcome).toEqual({ allowed: true });
  });

  it("blocks a resend inside the cooldown window", () => {
    const lastSentAt = new Date(NOW.getTime() - 10_000); // 10s ago, cooldown is 60s
    const outcome = evaluateOtpSend({ lastSentAt, sendsInWindow: 1, now: NOW });
    expect(outcome.allowed).toBe(false);
    expect(outcome).toMatchObject({ reason: "COOLDOWN" });
    if (!outcome.allowed && outcome.reason === "COOLDOWN") {
      expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
      expect(outcome.retryAfterSeconds).toBeLessThanOrEqual(OTP_RESEND_COOLDOWN_SECONDS);
    }
  });

  it("allows a resend once the cooldown has elapsed", () => {
    const lastSentAt = new Date(NOW.getTime() - (OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000);
    const outcome = evaluateOtpSend({ lastSentAt, sendsInWindow: 1, now: NOW });
    expect(outcome).toEqual({ allowed: true });
  });

  it(`blocks the ${OTP_MAX_SENDS_PER_WINDOW + 1}th send within the rolling window`, () => {
    const lastSentAt = new Date(NOW.getTime() - (OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000);
    const outcome = evaluateOtpSend({ lastSentAt, sendsInWindow: OTP_MAX_SENDS_PER_WINDOW, now: NOW });
    expect(outcome).toEqual({ allowed: false, reason: "SEND_CAP" });
  });
});

describe("shouldSupersedeOnResend", () => {
  it("supersedes a still-open PENDING challenge", () => {
    expect(shouldSupersedeOnResend("PENDING")).toBe(true);
  });

  it("does not touch a VERIFIED, LOCKED, EXPIRED, or already-SUPERSEDED challenge", () => {
    expect(shouldSupersedeOnResend("VERIFIED")).toBe(false);
    expect(shouldSupersedeOnResend("LOCKED")).toBe(false);
    expect(shouldSupersedeOnResend("EXPIRED")).toBe(false);
    expect(shouldSupersedeOnResend("SUPERSEDED")).toBe(false);
  });
});
