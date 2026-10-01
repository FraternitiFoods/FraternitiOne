/**
 * plan.md section 19 decision 2: "keep it behind SIGNING_METHOD=SMS_OTP |
 * AADHAAR_ESIGN (default SMS_OTP) so it can be switched on later." The one
 * place both the franchisee and company signing pages / actions check which
 * flow to render — no DB column, env-only, same as ESIGN_PROVIDER.
 */
export type SigningMethod = "SMS_OTP" | "AADHAAR_ESIGN";

export function currentSigningMethod(): SigningMethod {
  return process.env.SIGNING_METHOD === "AADHAAR_ESIGN" ? "AADHAAR_ESIGN" : "SMS_OTP";
}
