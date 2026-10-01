import { randomInt, createHmac, timingSafeEqual } from "node:crypto";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "./limits";

/**
 * plan.md section 19 "What gets built" #1 — pure, DB-free OTP logic, unit
 * tested directly (src/lib/otp/core.test.ts). No `server-only` import on
 * purpose, same reasoning as src/lib/onboarding/state.ts: this module takes
 * plain data in and returns a plain decision out, so it can be tested without
 * a database and imported from both the server action and (if ever needed) a
 * UI component. The DB-aware wrapper that reads/writes OtpChallenge rows
 * lives in src/lib/otp/challenge.ts, mirroring state.ts vs. its callers.
 */

export type OtpChallengeStatus = "PENDING" | "VERIFIED" | "EXPIRED" | "LOCKED" | "SUPERSEDED";

/** 6 digits via crypto.randomInt — never Math.random (section 19: "6 digits via crypto.randomInt"). */
export function generateOtpCode(): string {
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(0, max)).padStart(OTP_LENGTH, "0");
}

/**
 * The plain OTP is never stored — only HMAC-SHA256(secret, challengeId +
 * ":" + otp) is (section 19 hard rule). Binding the hash to the challenge id
 * means the same 6-digit code sent for two different challenges hashes to
 * two different values, so a leaked hash can't be replayed against another
 * challenge even if the code happened to repeat.
 */
export function hashOtpCode(secret: string, challengeId: string, code: string): string {
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export type OtpChallengeSnapshot = {
  id: string;
  status: OtpChallengeStatus;
  expiresAt: Date;
  attempts: number;
  codeHash: string;
  /** The LOI version + hash this challenge was issued for. */
  loiVersionId: string;
  pdfSha256: string;
};

export type OtpVerifyInput = {
  code: string;
  now: Date;
  secret: string;
  /** The LOI version/hash currently on the onboarding — checked against the challenge's own snapshot. */
  currentLoiVersionId: string;
  currentPdfSha256: string;
};

export type OtpVerifyOutcome =
  | { result: "VERIFIED" }
  | { result: "WRONG_CODE"; attempts: number; locked: boolean }
  | { result: "LOCKED" }
  | { result: "EXPIRED" }
  | { result: "ALREADY_USED" }
  | { result: "VERSION_MISMATCH" };

/**
 * The single decision point for "is this OTP verify allowed, and what
 * happens." Covers every negative case the build order calls out: correct
 * code passes, wrong code counts (and the 5th locks), expired fails, a
 * verified/superseded challenge can never be reused, and a newer LOI version
 * or changed hash fails verify even with the right code.
 */
export function evaluateOtpVerify(
  challenge: OtpChallengeSnapshot,
  input: OtpVerifyInput
): OtpVerifyOutcome {
  if (challenge.status === "VERIFIED" || challenge.status === "SUPERSEDED") {
    return { result: "ALREADY_USED" };
  }
  if (challenge.status === "LOCKED") {
    return { result: "LOCKED" };
  }
  if (challenge.status === "EXPIRED" || input.now.getTime() >= challenge.expiresAt.getTime()) {
    return { result: "EXPIRED" };
  }
  if (
    challenge.loiVersionId !== input.currentLoiVersionId ||
    challenge.pdfSha256 !== input.currentPdfSha256
  ) {
    return { result: "VERSION_MISMATCH" };
  }

  const expectedHash = hashOtpCode(input.secret, challenge.id, input.code);
  if (hashesMatch(expectedHash, challenge.codeHash)) {
    return { result: "VERIFIED" };
  }

  const nextAttempts = challenge.attempts + 1;
  const locked = nextAttempts >= OTP_MAX_ATTEMPTS;
  return locked
    ? { result: "WRONG_CODE", attempts: nextAttempts, locked: true }
    : { result: "WRONG_CODE", attempts: nextAttempts, locked: false };
}

export type OtpSendCheckInput = {
  /** Null if this signer has never been sent an OTP for this version. */
  lastSentAt: Date | null;
  /** Count of sends within the current rolling window — computed by the DB wrapper. */
  sendsInWindow: number;
  now: Date;
};

export type OtpSendCheckOutcome =
  | { allowed: true }
  | { allowed: false; reason: "COOLDOWN"; retryAfterSeconds: number }
  | { allowed: false; reason: "SEND_CAP" };

/** Resend cooldown (60s) and send cap (3 / 30 min) — section 19 "What gets built" #1. */
export function evaluateOtpSend(input: OtpSendCheckInput): OtpSendCheckOutcome {
  if (input.lastSentAt) {
    const cooldownMs = OTP_RESEND_COOLDOWN_SECONDS * 1000;
    const elapsedMs = input.now.getTime() - input.lastSentAt.getTime();
    if (elapsedMs < cooldownMs) {
      return { allowed: false, reason: "COOLDOWN", retryAfterSeconds: Math.ceil((cooldownMs - elapsedMs) / 1000) };
    }
  }
  if (input.sendsInWindow >= OTP_MAX_SENDS_PER_WINDOW) {
    return { allowed: false, reason: "SEND_CAP" };
  }
  return { allowed: true };
}

/** A new send supersedes only a still-open (PENDING) previous challenge — never one already VERIFIED/LOCKED/EXPIRED/SUPERSEDED. */
export function shouldSupersedeOnResend(previousStatus: OtpChallengeStatus): boolean {
  return previousStatus === "PENDING";
}
