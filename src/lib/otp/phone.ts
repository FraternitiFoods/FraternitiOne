/**
 * plan.md section 19 step-0 finding: StoreOnboarding.contactPhone / User.phone
 * are plain, unvalidated strings today (e.g. "9000000000" in existing seed/
 * e2e data) — this module is the one place that normalizes to E.164 for
 * sending, and masks for display ("+91 98•••••210", decision 5's own
 * example). India-only (section 17 NOT DECIDED YET #11: no foreign/NRI
 * applicants) — a 10-digit Indian mobile starting 6-9, optionally already
 * prefixed with +91/91/0.
 */

const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

/** Returns null if the input isn't a plausible 10-digit Indian mobile number. */
export function normalizePhoneToE164(raw: string): string | null {
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  if (!INDIAN_MOBILE_RE.test(digits)) return null;
  return `+91${digits}`;
}

/** "+919876543210" -> "+91 98•••••210" (decision 5's own example format: first 2 + last 3 of the national number shown, 5 digits masked). */
export function maskPhoneE164(e164: string): string {
  const match = /^\+91(\d{10})$/.exec(e164);
  if (!match) return "••••••••••";
  const national = match[1];
  return `+91 ${national.slice(0, 2)}•••••${national.slice(7)}`;
}
