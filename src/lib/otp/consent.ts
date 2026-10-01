/**
 * plan.md section 19 decision 6 / "What gets built" #6: versioned, shown
 * verbatim, snapshotted onto LoiAcceptance.consentText at the moment of
 * acceptance. Placeholder until legal approves (BLOCKERS.md #5) — the
 * "PLACEHOLDER — NOT APPROVED LEGAL TEXT" marking is shown as UI chrome
 * around this text (both signing pages, the acceptance certificate), not
 * baked into the sentence itself, so the stored string is exactly what a
 * lawyer would review verbatim later.
 *
 * No `server-only` import: both the signing pages (server components, to
 * render it) and src/lib/otp/challenge.ts (to snapshot it at verify time)
 * need this, and it's pure/DB-free either way.
 */

export const CONSENT_TEXT_VERSION = 1;

export type ConsentTextVars = {
  name: string;
  versionNo: string;
  pdfSha256: string;
  phoneMasked: string;
};

export function renderConsentText(vars: ConsentTextVars): string {
  const fingerprint = vars.pdfSha256.slice(0, 12);
  return (
    `I, ${vars.name}, have read LOI ${vars.versionNo} (document fingerprint ${fingerprint}) ` +
    `and agree to its terms. I understand that entering the OTP sent to ${vars.phoneMasked} ` +
    `is my electronic acceptance of this LOI.`
  );
}
