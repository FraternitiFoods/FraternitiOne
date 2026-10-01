import "server-only";

/**
 * plan.md section 19 "SMS adapter": same pattern as src/lib/esign/provider.ts
 * — provider-agnostic interface, everything vendor-specific lives in
 * src/lib/sms/. Nothing outside this directory may know which vendor is
 * configured; every call site imports `getSmsProvider()` (index.ts), never a
 * concrete provider class directly.
 */
export type SendSmsInput = {
  to: string; // E.164, e.g. "+919876543210"
  templateKey: "LOI_OTP";
  vars: Record<string, string>;
};

export interface SmsProvider {
  send(input: SendSmsInput): Promise<{ providerMessageId: string }>;
}
