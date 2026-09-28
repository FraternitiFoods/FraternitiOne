import "server-only";

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { createHash } from "node:crypto";
import { FRATERNITI_LOGO_PNG_BASE64, TULSI_LOGO_PNG_BASE64, PAYMENT_QR_JPG_BASE64 } from "./loi-assets";

/**
 * plan.md section 17 "LOI engine": render to PDF with a serverless-friendly
 * library — no headless Chrome/Puppeteer (Vercel function size limits,
 * plan.md section 12). pdf-lib draws text/images directly, no HTML/CSS
 * layer, which is exactly what "serverless-friendly" buys here.
 *
 * The layout below mirrors the director-approved Tulsi LOI reference
 * document section-by-section (brand header, title block, clauses,
 * signatures, bank details + payment QR) using the template's §SECTION
 * markers from loi-template.ts — it is not a pixel-identical reproduction
 * of that PDF, since that document isn't produced by a template engine.
 */

export type LoiValues = {
  name: string;
  aadhaarMasked: string;
  feeAmount: string;
  feeInWords: string;
  territory: string;
  issueDate: string;
  versionNo: string;
};

function renderTemplate(body: string, values: LoiValues): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => (values as Record<string, string>)[key] ?? "");
}

const REQUIRED_VALUE_KEYS: (keyof LoiValues)[] = [
  "name",
  "aadhaarMasked",
  "feeAmount",
  "feeInWords",
  "territory",
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

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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

function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = body.split(/^§(\w+)$/m);
  // parts[0] is any text before the first marker (ignored); then alternating name/content.
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i];
    const content = (parts[i + 1] ?? "").trim();
    sections[name] = content;
  }
  return sections;
}

const HEADER_HEIGHT = 62;
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export async function generateLoiPdf(params: {
  templateBody: string;
  values: LoiValues;
}): Promise<{ pdfBytes: Uint8Array; sha256: string }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const fraternitiLogo = await doc.embedPng(Buffer.from(FRATERNITI_LOGO_PNG_BASE64, "base64"));
  const tulsiLogo = await doc.embedPng(Buffer.from(TULSI_LOGO_PNG_BASE64, "base64"));
  const qrImage = await doc.embedJpg(Buffer.from(PAYMENT_QR_JPG_BASE64, "base64"));

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = 0;

  function drawHeader(p: PDFPage) {
    p.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_HEIGHT, width: PAGE_WIDTH, height: HEADER_HEIGHT, color: rgb(0, 0, 0) });
    const logoSize = 42;
    p.drawImage(fraternitiLogo, {
      x: MARGIN,
      y: PAGE_HEIGHT - HEADER_HEIGHT / 2 - logoSize / 2,
      width: logoSize,
      height: (logoSize * fraternitiLogo.height) / fraternitiLogo.width,
    });
    const dividerX = MARGIN + logoSize + 14;
    p.drawLine({
      start: { x: dividerX, y: PAGE_HEIGHT - HEADER_HEIGHT + 10 },
      end: { x: dividerX, y: PAGE_HEIGHT - 10 },
      thickness: 1,
      color: rgb(1, 1, 1),
    });
    const wordmarkX = dividerX + 14;
    p.drawText("Fraterniti Luxury", {
      x: wordmarkX,
      y: PAGE_HEIGHT - HEADER_HEIGHT / 2 - 4,
      size: 16,
      font: boldFont,
      color: rgb(1, 1, 1),
    });
    p.drawText("FRATERNITI LUXURY PVT LTD", {
      x: wordmarkX,
      y: PAGE_HEIGHT - HEADER_HEIGHT / 2 - 18,
      size: 7,
      font,
      color: rgb(0.85, 0.85, 0.85),
    });
  }

  function newPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page);
    y = PAGE_HEIGHT - HEADER_HEIGHT - 30;
  }

  drawHeader(page);
  y = PAGE_HEIGHT - HEADER_HEIGHT - 30;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) newPage();
  }

  function drawParagraph(text: string, opts: { size?: number; font?: PDFFont; lineHeight?: number; gapAfter?: number; indent?: number } = {}) {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const lineHeight = opts.lineHeight ?? size * 1.4;
    const indent = opts.indent ?? 0;
    // Source text sometimes wraps a single sentence across lines for
    // readability in loi-template.ts — collapse those into spaces before
    // re-wrapping to the actual page width, instead of drawing a literal
    // (unencodable) newline character.
    const safeText = toWinAnsiSafe(text.replace(/\s*\n\s*/g, " "));
    const lines = wrapText(safeText, f, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      ensureSpace(lineHeight);
      page.drawText(line, { x: MARGIN + indent, y, size, font: f });
      y -= lineHeight;
    }
    y -= opts.gapAfter ?? 6;
  }

  function drawBullets(text: string) {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const content = line.startsWith("- ") ? line.slice(2) : line;
      const bulletSize = 10;
      const lineHeight = bulletSize * 1.4;
      const lines = wrapText(toWinAnsiSafe(content), font, bulletSize, CONTENT_WIDTH - 16);
      lines.forEach((l, i) => {
        ensureSpace(lineHeight);
        if (i === 0) {
          page.drawText(toWinAnsiSafe("•"), { x: MARGIN, y, size: bulletSize, font });
        }
        page.drawText(l, { x: MARGIN + 14, y, size: bulletSize, font });
        y -= lineHeight;
      });
    }
    y -= 6;
  }

  function drawSectionHeading(text: string) {
    ensureSpace(22);
    page.drawText(toWinAnsiSafe(text), { x: MARGIN, y, size: 12, font: boldFont });
    y -= 20;
  }

  const sections = parseSections(renderTemplate(params.templateBody, params.values));

  // --- Page 1: title block + fields + intro + core terms ---
  const tulsiLogoWidth = 170;
  const tulsiLogoHeight = (tulsiLogoWidth * tulsiLogo.height) / tulsiLogo.width;
  page.drawImage(tulsiLogo, {
    x: PAGE_WIDTH - MARGIN - tulsiLogoWidth,
    y: y - tulsiLogoHeight + 10,
    width: tulsiLogoWidth,
    height: tulsiLogoHeight,
  });

  const [tulsiTitle, loiTitle] = (sections.TITLE ?? "").split("\n").filter(Boolean);
  page.drawText(toWinAnsiSafe(tulsiTitle ?? "Tulsi"), { x: MARGIN, y, size: 20, font: boldFont });
  y -= 26;
  page.drawText(toWinAnsiSafe(loiTitle ?? "Letter of Intent"), { x: MARGIN, y, size: 13, font });
  y -= 40;

  for (const line of (sections.FIELDS ?? "").split("\n").filter(Boolean)) {
    drawParagraph(line, { size: 11, gapAfter: 4 });
  }
  y -= 10;

  drawParagraph(sections.INTRO ?? "", { gapAfter: 14 });

  for (const para of (sections.DEFS ?? "").split("\n\n")) {
    drawParagraph(para.trim(), { gapAfter: 12 });
  }

  // --- Page 2: Territory blocking fee + Services ---
  newPage();
  const feeParas = (sections.FEES ?? "").split("\n\n");
  drawSectionHeading("Territory Blocking Fees");
  for (const para of feeParas) {
    drawParagraph(para.replace(/^Territory Blocking Fees:\s*/, "").trim(), { gapAfter: 12 });
  }

  const servicesBlocks = (sections.SERVICES ?? "").split("\n\n");
  drawSectionHeading("Services");
  for (const block of servicesBlocks) {
    if (block.startsWith("Services:") || block.startsWith("The setup process")) {
      drawParagraph(block.trim(), { gapAfter: 10 });
    } else if (block.startsWith("- ")) {
      drawBullets(block);
    } else if (block.trim()) {
      drawParagraph(block.trim(), { gapAfter: 10 });
    }
  }

  // --- Royalty / operating expenses ---
  for (const block of (sections.ROYALTY ?? "").split("\n\n")) {
    if (block.startsWith("- ")) {
      drawBullets(block);
    } else if (block.trim()) {
      drawParagraph(block.trim());
    }
  }

  // --- Confidentiality ---
  drawParagraph(sections.CONFIDENTIAL ?? "", { gapAfter: 12 });

  // --- Page 4: governing law, signatures, bank details ---
  newPage();
  const governingParas = (sections.GOVERNING ?? "").split("\n\n");
  for (const para of governingParas) {
    drawParagraph(para.trim(), { gapAfter: 12 });
  }

  ensureSpace(120);
  drawSectionHeading("Agreed and Confirmed");
  drawParagraph("_______________________", { gapAfter: 2 });
  drawParagraph("For Franchisee", { gapAfter: 20 });

  drawSectionHeading("Agreed and Confirmed");
  const directorColX = [MARGIN, MARGIN + CONTENT_WIDTH / 2];
  const directorLines = [
    ["Mr. Rohit Tandon", "Director", "Fraterniti Luxury Pvt Ltd", "For Franchisor"],
    ["Mr. Karan Makan", "Director", "Fraterniti Luxury Pvt Ltd", "For Franchisor"],
  ];
  ensureSpace(70);
  const directorStartY = y;
  directorLines.forEach((lines, col) => {
    let ly = directorStartY;
    lines.forEach((line, i) => {
      page.drawText(toWinAnsiSafe(line), { x: directorColX[col], y: ly, size: i === 0 ? 11 : 10, font: i === 0 ? boldFont : font });
      ly -= 14;
    });
  });
  y = directorStartY - 14 * 4 - 24;

  drawSectionHeading("Bank Details");
  const bankLines = (sections.BANK ?? "").split("\n").filter((l) => l && l !== "Bank Details");
  const qrWidth = 130;
  const qrHeight = (qrWidth * qrImage.height) / qrImage.width;
  ensureSpace(qrHeight + 10);
  const bankTextTopY = y;
  for (const line of bankLines) {
    drawParagraph(line, { size: 10, gapAfter: 4 });
  }
  page.drawImage(qrImage, {
    x: PAGE_WIDTH - MARGIN - qrWidth,
    y: bankTextTopY - qrHeight + 12,
    width: qrWidth,
    height: qrHeight,
  });

  const pdfBytes = await doc.save();
  const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
  return { pdfBytes, sha256 };
}
