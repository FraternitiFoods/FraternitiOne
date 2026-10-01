/**
 * plan.md section 19 "What gets built" #1 / "NOT DECIDED YET" #5: "all
 * limits live as constants in one file." Nothing outside this file should
 * hardcode any of these numbers.
 */
export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_SENDS_PER_WINDOW = 3;
export const OTP_SEND_WINDOW_MINUTES = 30;
