import "server-only";

import { MockSmsProvider } from "./mock-provider";
import type { SmsProvider } from "./provider";

export type { SmsProvider } from "./provider";

/**
 * plan.md section 19: "SMS_PROVIDER=mock (default): ... Refuse to run in
 * production unless ALLOW_MOCK_SMS_IN_PRODUCTION=true." Exact mirror of
 * src/lib/esign/index.ts's getEsignProvider() — one gate, every call site
 * (OTP send action, the real webhook equivalent if one is ever added) goes
 * through this, never a concrete provider class directly.
 */
export function getSmsProvider(): SmsProvider {
  const providerName = process.env.SMS_PROVIDER || "mock";

  if (providerName === "mock") {
    const allowInProduction = process.env.ALLOW_MOCK_SMS_IN_PRODUCTION === "true";
    if (process.env.NODE_ENV === "production" && !allowInProduction) {
      throw new Error(
        "SMS_PROVIDER=mock cannot run in production. Configure a real SMS vendor before releasing OTP signing."
      );
    }
    return new MockSmsProvider();
  }

  // Real vendor adapters register here as they're built — one new file
  // implementing SmsProvider + a branch here (plan.md section 19: "Real
  // provider = one new file + env vars, added only after blockers 1-2 are
  // cleared" — see BLOCKERS.md).
  throw new Error(`Unknown SMS_PROVIDER "${providerName}" — no adapter implemented yet.`);
}

export function currentSmsProviderName(): string {
  return process.env.SMS_PROVIDER || "mock";
}

/** Drives the certificate's "TEST OTP — NOT A REAL SMS" watermark (section 19 "SMS adapter"). */
export function isMockSmsActive(): boolean {
  return currentSmsProviderName() === "mock";
}
