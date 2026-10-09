import "server-only";

import type { PDFFont } from "pdf-lib";

/**
 * Generic pdf-lib drawing helpers, extracted out of onboarding/loi-pdf.ts
 * (the first PDF generator in this repo) once a second one (board-digest-pdf.ts)
 * needed the exact same text-wrapping and Unicode-sanitizing logic — shared
 * here instead of duplicated. Nothing LOI-specific lives in this file;
 * header/branding/legal-clause layout stays in loi-pdf.ts.
 */

export const PAGE_WIDTH = 595.28; // A4
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 50;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// pdf-lib's StandardFonts (Helvetica etc.) use WinAnsi (Windows-1252)
// encoding, which covers Latin text plus common "smart punctuation" but NOT
// the Rupee sign or any non-Latin script. Drawing an unencodable character
// throws and crashes generation outright -- a real bug found via testing:
// the fee amount is *always* rendered with the Rupee sign, so LOI generation
// would have failed on every single real Indian-Rupee LOI, not just in test
// data. The Rupee sign gets a specific, readable replacement; anything else
// outside WinAnsi's range falls back to "?" so a free-text field (Territory)
// with an unexpected character can never crash the whole document, just
// look slightly odd in that one spot.
const RUPEE_SIGN = String.fromCodePoint(0x20b9);
const WINANSI_EXTRA_CODEPOINTS = new Set([
  0x2013, // en dash
  0x2014, // em dash
  0x2018, // left single quote
  0x2019, // right single quote
  0x201c, // left double quote
  0x201d, // right double quote
  0x2022, // bullet
  0x2026, // ellipsis
]);

export function toWinAnsiSafe(text: string): string {
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

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const words = text.split(" ");
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
