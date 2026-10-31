import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { PAGE_WIDTH, PAGE_HEIGHT, MARGIN, CONTENT_WIDTH, toWinAnsiSafe, wrapText } from "@/lib/pdf-utils";
import { getObjectBuffer } from "@/lib/storage";
import { formatCurrency, formatDate } from "@/lib/format";

/**
 * Purchase Order PDF (plan.md sections 4.5 and 6.6): company header, PO
 * number/date, vendor block, deliver-to site, item photos, amount columns,
 * GST, grand total, the 4 terms, signature line. Regenerated fresh on every
 * download from the PurchaseOrder's own stored snapshots (companySnapshot /
 * vendorSnapshot / siteSnapshot / termsSnapshot) — never from live
 * Vendor/Site/Settings rows, which may have changed since the PO was created.
 */

export type PoPdfCompany = {
  name: string;
  address: string;
  gstin: string;
  phone: string;
  email: string;
  signatoryName: string;
};

export type PoPdfVendor = {
  name: string;
  address: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
};

export type PoPdfSite = {
  name: string;
  shortCode: string | null;
  note: string | null;
};

export type PoPdfLine = {
  nameSnapshot: string;
  remarkSize: string | null;
  qty: number;
  rate: number;
  amount: number;
  photoStorageKey: string | null;
};

export type PoPdfData = {
  poNumber: string;
  poDate: Date;
  deliveryBy: Date | null;
  deliveryDays: number;
  paymentTerms: string;
  gstPercent: number;
  subtotal: number;
  gstAmount: number;
  total: number;
  company: PoPdfCompany;
  vendor: PoPdfVendor;
  site: PoPdfSite;
  categoryName: string;
  /** PO terms snapshot (plan.md section 6.6) — exactly 4 lines at creation time. */
  terms: string[];
  lines: PoPdfLine[];
};

const NOT_SET = "[Not set]";

function valueOrPlaceholder(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed || NOT_SET;
}

function pushIfBlank(value: string | null | undefined, label: string, missing: string[]): void {
  if (!(value ?? "").trim()) missing.push(label);
}

/**
 * Per this session's instruction: "If company/vendor details are empty,
 * still generate the PDF and mark the missing fields clearly instead of
 * failing." Also used by the create/preview/detail pages to show "List what
 * I must fill in" without duplicating the blank-field rule.
 */
export function collectMissingPoFields(data: Pick<PoPdfData, "company" | "vendor">): string[] {
  const missing: string[] = [];
  pushIfBlank(data.company.name, "Company name", missing);
  pushIfBlank(data.company.address, "Company address", missing);
  pushIfBlank(data.company.gstin, "Company GSTIN", missing);
  pushIfBlank(data.company.phone, "Company phone", missing);
  pushIfBlank(data.company.email, "Company email", missing);
  pushIfBlank(data.company.signatoryName, "Signatory name", missing);
  const vendorLabel = data.vendor.name.trim() || "Vendor";
  pushIfBlank(data.vendor.address, `${vendorLabel} address`, missing);
  pushIfBlank(data.vendor.gstin, `${vendorLabel} GSTIN`, missing);
  pushIfBlank(data.vendor.phone, `${vendorLabel} phone`, missing);
  pushIfBlank(data.vendor.email, `${vendorLabel} email`, missing);
  return missing;
}

const FONT_SIZE = 9;
const LINE_HEIGHT = 11;
const PHOTO_SIZE = 30;
const ROW_PADDING = 4;

// Item | Qty | Rate | Amount — the photo square is drawn inside the Item
// column's left edge, so it doesn't need its own column width.
const COL = {
  item: MARGIN,
  itemWidth: 260,
  qty: MARGIN + 260,
  rate: MARGIN + 260 + 55,
  amount: MARGIN + 260 + 55 + 75,
};

type Cursor = { doc: PDFDocument; page: PDFPage; y: number; font: PDFFont; bold: PDFFont };

function newPage(cursor: Pick<Cursor, "doc" | "font" | "bold">): Cursor {
  const page = cursor.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return { ...cursor, page, y: PAGE_HEIGHT - MARGIN };
}

function text(cursor: Cursor, value: string, x: number, size = FONT_SIZE, font?: PDFFont, color = rgb(0, 0, 0)) {
  cursor.page.drawText(toWinAnsiSafe(value), { x, y: cursor.y, size, font: font ?? cursor.font, color });
}

function ensureSpace(cursor: Cursor, needed: number): Cursor {
  if (cursor.y - needed < MARGIN) return newPage(cursor);
  return cursor;
}

function drawRule(cursor: Cursor) {
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: MARGIN + CONTENT_WIDTH, y: cursor.y },
    thickness: 0.75,
    color: rgb(0.4, 0.4, 0.4),
  });
}

function drawTableHeader(cursor: Cursor): Cursor {
  cursor.y -= LINE_HEIGHT;
  text(cursor, "Item", COL.item, FONT_SIZE, cursor.bold);
  text(cursor, "Qty", COL.qty, FONT_SIZE, cursor.bold);
  text(cursor, "Rate", COL.rate, FONT_SIZE, cursor.bold);
  text(cursor, "Amount", COL.amount, FONT_SIZE, cursor.bold);
  cursor.y -= 3;
  drawRule(cursor);
  cursor.y -= LINE_HEIGHT;
  return cursor;
}

async function embedLinePhoto(cursor: Cursor, key: string) {
  try {
    const bytes = await getObjectBuffer(key);
    const lower = key.toLowerCase();
    if (lower.endsWith(".png")) return await cursor.doc.embedPng(bytes);
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return await cursor.doc.embedJpg(bytes);
    return null; // webp/gif aren't supported by pdf-lib without a conversion step
  } catch {
    // Missing/misconfigured storage, or a deleted object — never fail PO
    // generation over a thumbnail; the line still renders without a photo.
    return null;
  }
}

async function drawLine(cursor: Cursor, line: PoPdfLine): Promise<Cursor> {
  const nameLines = wrapText(line.nameSnapshot, cursor.font, FONT_SIZE, COL.itemWidth - PHOTO_SIZE - 6);
  const remarkLines = line.remarkSize
    ? wrapText(`(${line.remarkSize})`, cursor.font, FONT_SIZE - 1, COL.itemWidth - PHOTO_SIZE - 6)
    : [];
  const textLineCount = nameLines.length + remarkLines.length;
  const rowHeight = Math.max(PHOTO_SIZE + ROW_PADDING, textLineCount * LINE_HEIGHT + ROW_PADDING);

  let c = ensureSpace(cursor, rowHeight + LINE_HEIGHT);
  if (c.page !== cursor.page) c = drawTableHeader(c);

  const rowTop = c.y;
  const textX = COL.item + (line.photoStorageKey ? PHOTO_SIZE + 6 : 0);

  if (line.photoStorageKey) {
    const image = await embedLinePhoto(c, line.photoStorageKey);
    if (image) {
      const scale = Math.min(PHOTO_SIZE / image.width, PHOTO_SIZE / image.height);
      c.page.drawImage(image, {
        x: COL.item,
        y: rowTop - PHOTO_SIZE,
        width: image.width * scale,
        height: image.height * scale,
      });
    }
  }

  let lineY = rowTop;
  for (const nameLine of nameLines) {
    text({ ...c, y: lineY }, nameLine, textX);
    lineY -= LINE_HEIGHT;
  }
  for (const remarkLine of remarkLines) {
    text({ ...c, y: lineY }, remarkLine, textX, FONT_SIZE - 1, undefined, rgb(0.4, 0.4, 0.4));
    lineY -= LINE_HEIGHT;
  }

  const rateText = line.rate > 0 ? formatCurrency(line.rate, 2) : "No rate";
  text({ ...c, y: rowTop }, formatNumber(line.qty), COL.qty);
  text({ ...c, y: rowTop }, rateText, COL.rate);
  text({ ...c, y: rowTop }, formatCurrency(line.amount, 2), COL.amount);

  c.y = rowTop - rowHeight;
  return c;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

/** Generates the PO PDF and returns its bytes. Never throws on missing company/vendor data — blank fields render as "[Not set]" (see collectMissingPoFields). */
export async function generatePurchaseOrderPdf(data: PoPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let cursor: Cursor = newPage({ doc, font, bold });
  const missing = collectMissingPoFields(data);

  // Header
  text(cursor, valueOrPlaceholder(data.company.name), MARGIN, 16, bold);
  text(cursor, "PURCHASE ORDER", MARGIN + CONTENT_WIDTH - 140, 14, bold);
  cursor.y -= 20;

  const companyAddressLine = valueOrPlaceholder(data.company.address);
  const companyContactLine = `GSTIN: ${valueOrPlaceholder(data.company.gstin)}   Phone: ${valueOrPlaceholder(data.company.phone)}   Email: ${valueOrPlaceholder(data.company.email)}`;
  for (const raw of [companyAddressLine, companyContactLine]) {
    for (const line of wrapText(raw, font, FONT_SIZE, 280)) {
      text(cursor, line, MARGIN, FONT_SIZE);
      cursor.y -= LINE_HEIGHT;
    }
  }

  const detailsY = cursor.y + LINE_HEIGHT * 2;
  text({ ...cursor, y: detailsY }, `PO Number: ${data.poNumber}`, MARGIN + CONTENT_WIDTH - 180, FONT_SIZE, bold);
  text({ ...cursor, y: detailsY - LINE_HEIGHT }, `PO Date: ${formatDate(data.poDate)}`, MARGIN + CONTENT_WIDTH - 180, FONT_SIZE);
  if (data.deliveryBy) {
    text(
      { ...cursor, y: detailsY - LINE_HEIGHT * 2 },
      `Delivery by: ${formatDate(data.deliveryBy)} (${data.deliveryDays} days)`,
      MARGIN + CONTENT_WIDTH - 180,
      FONT_SIZE
    );
  }
  cursor.y -= LINE_HEIGHT;

  if (missing.length > 0) {
    cursor.y -= LINE_HEIGHT;
    const warningLines = wrapText(`Missing details — fill in before sending: ${missing.join(", ")}.`, bold, FONT_SIZE, CONTENT_WIDTH);
    for (const line of warningLines) {
      text(cursor, line, MARGIN, FONT_SIZE, bold, rgb(0.6, 0.1, 0.1));
      cursor.y -= LINE_HEIGHT;
    }
  }
  cursor.y -= LINE_HEIGHT;

  // Vendor / Deliver-to blocks
  text(cursor, "Vendor", MARGIN, FONT_SIZE, bold);
  text(cursor, "Deliver to", MARGIN + 300, FONT_SIZE, bold);
  cursor.y -= LINE_HEIGHT;

  const vendorDetailLines = [
    valueOrPlaceholder(data.vendor.name),
    valueOrPlaceholder(data.vendor.address),
    `GSTIN: ${valueOrPlaceholder(data.vendor.gstin)}`,
    `Phone: ${valueOrPlaceholder(data.vendor.phone)}`,
    `Email: ${valueOrPlaceholder(data.vendor.email)}`,
  ];
  const siteDetailLines = [
    data.site.shortCode ? `${data.site.name} (${data.site.shortCode})` : data.site.name,
    data.site.note ?? "",
    `Category: ${data.categoryName}`,
    `Payment terms: ${data.paymentTerms}`,
  ].filter(Boolean);

  const blockRows = Math.max(vendorDetailLines.length, siteDetailLines.length);
  for (let i = 0; i < blockRows; i++) {
    if (vendorDetailLines[i]) text(cursor, vendorDetailLines[i], MARGIN);
    if (siteDetailLines[i]) text(cursor, siteDetailLines[i], MARGIN + 300);
    cursor.y -= LINE_HEIGHT;
  }
  cursor.y -= LINE_HEIGHT;

  // Items table
  cursor = drawTableHeader(cursor);
  for (const line of data.lines) {
    cursor = await drawLine(cursor, line);
  }

  cursor.y -= 4;
  drawRule(cursor);
  cursor.y -= LINE_HEIGHT;

  // Totals
  cursor = ensureSpace(cursor, LINE_HEIGHT * 3 + 10);
  text(cursor, "Subtotal", COL.rate, FONT_SIZE, bold);
  text(cursor, formatCurrency(data.subtotal, 2), COL.amount, FONT_SIZE);
  cursor.y -= LINE_HEIGHT;
  text(cursor, `GST (${data.gstPercent}%)`, COL.rate, FONT_SIZE, bold);
  text(cursor, formatCurrency(data.gstAmount, 2), COL.amount, FONT_SIZE);
  cursor.y -= LINE_HEIGHT;
  text(cursor, "Grand Total", COL.rate, FONT_SIZE, bold);
  text(cursor, formatCurrency(data.total, 2), COL.amount, FONT_SIZE, bold);
  cursor.y -= LINE_HEIGHT * 2;

  // Terms
  cursor = ensureSpace(cursor, LINE_HEIGHT * (data.terms.length + 2));
  text(cursor, "Terms", MARGIN, FONT_SIZE, bold);
  cursor.y -= LINE_HEIGHT;
  for (const [i, term] of data.terms.entries()) {
    const wrapped = wrapText(`${i + 1}. ${term}`, font, FONT_SIZE, CONTENT_WIDTH);
    for (const line of wrapped) {
      cursor = ensureSpace(cursor, LINE_HEIGHT);
      text(cursor, line, MARGIN, FONT_SIZE);
      cursor.y -= LINE_HEIGHT;
    }
  }
  cursor.y -= LINE_HEIGHT * 2;

  // Signature
  cursor = ensureSpace(cursor, LINE_HEIGHT * 4 + 20);
  text(cursor, `For ${valueOrPlaceholder(data.company.name)}`, MARGIN + CONTENT_WIDTH - 180, FONT_SIZE, bold);
  cursor.y -= 40;
  cursor.page.drawLine({
    start: { x: MARGIN + CONTENT_WIDTH - 180, y: cursor.y },
    end: { x: MARGIN + CONTENT_WIDTH, y: cursor.y },
    thickness: 0.75,
    color: rgb(0.4, 0.4, 0.4),
  });
  cursor.y -= LINE_HEIGHT;
  text(cursor, valueOrPlaceholder(data.company.signatoryName), MARGIN + CONTENT_WIDTH - 180, FONT_SIZE);
  cursor.y -= LINE_HEIGHT;
  text(cursor, "Authorized Signatory", MARGIN + CONTENT_WIDTH - 180, FONT_SIZE - 1, undefined, rgb(0.4, 0.4, 0.4));

  return doc.save();
}
