import "server-only";

import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

/**
 * plan.md section 19 "What gets built" #7 — generated once both acceptances
 * exist (called from the webhook-processor's COMPANY-completion branch, same
 * moment the Aadhaar flow would have fetched a vendor certificate). Lists
 * both signers, the LOI version/hash, consent text version, and challenge
 * ids — this is the OTP flow's own certificate, replacing a vendor's, since
 * there is no vendor. Built with pdf-lib (no headless Chrome), same
 * constraint as loi-pdf.ts.
 */

export type AcceptanceCertificateSigner = {
  role: "FRANCHISEE" | "COMPANY";
  name: string;
  phoneMasked: string;
  acceptedAt: Date;
  ip: string | null;
  otpChallengeId: string;
};

export type AcceptanceCertificateInput = {
  onboardingCode: string;
  storeLabel: string;
  loiVersionNo: string;
  pdfSha256: string;
  consentTextVersion: number;
  signers: AcceptanceCertificateSigner[];
  /** True whenever SMS_PROVIDER=mock (section 19 "SMS adapter": mock output must be watermarked). */
  watermark: boolean;
};

function formatIst(date: Date): string {
  return `${date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" })} IST`;
}

export async function generateAcceptanceCertificatePdf(input: AcceptanceCertificateInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 500]);
  const left = 40;
  let y = 450;

  const drawLine = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) => {
    page.drawText(text, {
      x: left,
      y,
      size: opts.size ?? 11,
      font: opts.bold ? bold : font,
      color: opts.color ? rgb(...opts.color) : rgb(0, 0, 0),
    });
    y -= (opts.size ?? 11) + 8;
  };

  drawLine("LOI ACCEPTANCE CERTIFICATE", { size: 16, bold: true });
  drawLine("Signing method: mobile OTP (SMS_OTP) — see plan.md section 19.", { size: 9, color: [0.4, 0.4, 0.4] });
  y -= 6;

  drawLine(`Store: ${input.onboardingCode} — ${input.storeLabel}`);
  drawLine(`LOI version: ${input.loiVersionNo}`);
  drawLine(`LOI document SHA-256: ${input.pdfSha256}`);
  drawLine(`Consent text version: ${input.consentTextVersion} (placeholder — not approved legal text)`);
  y -= 10;

  for (const signer of input.signers) {
    drawLine(`${signer.role === "FRANCHISEE" ? "Franchisee" : "Company signatory"}: ${signer.name}`, { bold: true });
    drawLine(`  Mobile: ${signer.phoneMasked}`);
    drawLine(`  Accepted at: ${formatIst(signer.acceptedAt)}`);
    drawLine(`  IP address: ${signer.ip ?? "(not recorded)"}`);
    drawLine(`  OTP verified: yes (challenge ${signer.otpChallengeId})`);
    y -= 6;
  }

  y -= 10;
  drawLine(
    "This certificate records that each signer above entered a one-time code sent to the mobile",
    { size: 9, color: [0.4, 0.4, 0.4] }
  );
  drawLine(
    "number on file as their electronic acceptance of the exact LOI document identified above.",
    { size: 9, color: [0.4, 0.4, 0.4] }
  );
  drawLine(
    "This is a simple OTP acceptance, not an Aadhaar e-sign — whether it is legally sufficient for",
    { size: 9, color: [0.4, 0.4, 0.4] }
  );
  drawLine(
    "this LOI is a decision for the company's legal counsel, not an engineering determination.",
    { size: 9, color: [0.4, 0.4, 0.4] }
  );

  if (input.watermark) {
    const watermarkFont = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText("TEST OTP — NOT A REAL SMS, NOT LEGALLY BINDING", {
      x: 20,
      y: 250,
      size: 20,
      font: watermarkFont,
      color: rgb(0.85, 0, 0),
      rotate: degrees(45),
      opacity: 0.45,
    });
  }

  return Buffer.from(await doc.save());
}
