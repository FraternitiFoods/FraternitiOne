import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash } from "node:crypto";

/**
 * plan.md section 17 "LOI engine": render to PDF with a serverless-friendly
 * library — no headless Chrome/Puppeteer (Vercel function size limits,
 * plan.md section 12). pdf-lib draws text directly, no HTML/CSS layer, which
 * is exactly what "serverless-friendly" buys here.
 */

export type LoiValues = {
  brand: string;
  storeLocation: string;
  applicantLegalName: string;
  entityType: string;
  companyName: string;
  feeAmount: string;
  feeInWords: string;
  territory: string;
  commercialTerms: string;
  issueDate: string;
  versionNo: string;
};

function renderTemplate(body: string, values: LoiValues): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => (values as Record<string, string>)[key] ?? "");
}

const REQUIRED_VALUE_KEYS: (keyof LoiValues)[] = [
  "brand",
  "storeLocation",
  "applicantLegalName",
  "entityType",
  "feeAmount",
  "territory",
  "commercialTerms",
  "issueDate",
  "versionNo",
];

export function validateLoiValues(values: Partial<LoiValues>): string | null {
  for (const key of REQUIRED_VALUE_KEYS) {
    if (!values[key] || String(values[key]).trim() === "") {
      return `Missing required LOI field: ${key}.`;
    }
  }
  return null;
}

// pdf-lib's StandardFonts (Helvetica etc.) use WinAnsi (Windows-1252)
// encoding, which covers Latin text plus common "smart punctuation" but NOT
// the Rupee sign or any non-Latin script. Drawing an unencodable character
// throws and crashes generation outright -- a real bug found via testing:
// the fee amount is *always* rendered with the Rupee sign, so LOI generation
// would have failed on every single real Indian-Rupee LOI, not just in test
// data. The Rupee sign gets a specific, readable replacement; anything else
// outside WinAnsi's range falls back to "?" so a free-text field (Territory,
// Commercial terms) with an unexpected character can never crash the whole
// document, just look slightly odd in that one spot.
const RUPEE_SIGN = String.fromCodePoint(0x20b9);
const WINANSI_EXTRA_CODEPOINTS = new Set([
  0x2013, // en dash
  0x2014, // em dash
  0x2018, // left single quote
  0x2019, // right single quote
  0x201c, // left double quote
  0x201d, // right double quote
  0x2026, // ellipsis
]);

function toWinAnsiSafe(text: string): string {
  return Array.from(text.split(RUPEE_SIGN).join("Rs. "))
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= 0x20 && code <= 0x7e) return ch; // ASCII printable
      if (code >= 0xa0 && code <= 0xff) return ch; // Latin-1 supplement
      if (WINANSI_EXTRA_CODEPOINTS.has(code)) return ch; // common smart punctuation
      return "?";
    })
    .join("");
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxCharsPerLine) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

export async function generateLoiPdf(params: {
  templateBody: string;
  isPlaceholder: boolean;
  values: LoiValues;
}): Promise<{ pdfBytes: Uint8Array; sha256: string }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 50;
  const maxCharsPerLine = 90;
  const lineHeight = 14;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function newPageIfNeeded(needed: number) {
    if (y - needed < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      if (params.isPlaceholder) drawPlaceholderStamp();
    }
  }

  function drawPlaceholderStamp() {
    page.drawText(toWinAnsiSafe("PLACEHOLDER - NOT APPROVED LEGAL TEXT"), {
      x: margin,
      y: pageHeight - 25,
      size: 10,
      font: boldFont,
      color: rgb(0.8, 0, 0),
    });
  }

  if (params.isPlaceholder) drawPlaceholderStamp();

  page.drawText(toWinAnsiSafe(`Letter of Intent - v${params.values.versionNo}`), {
    x: margin,
    y,
    size: 16,
    font: boldFont,
  });
  y -= 28;

  const rendered = toWinAnsiSafe(renderTemplate(params.templateBody, params.values));
  for (const line of wrapText(rendered, maxCharsPerLine)) {
    newPageIfNeeded(lineHeight);
    page.drawText(line, { x: margin, y, size: 10, font });
    y -= lineHeight;
  }

  const pdfBytes = await doc.save();
  const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
  return { pdfBytes, sha256 };
}
