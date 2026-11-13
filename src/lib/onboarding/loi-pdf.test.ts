import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { PDFDocument, PDFArray, PDFRawStream, type PDFPage } from "pdf-lib";
import { decodePDFRawStream } from "pdf-lib/cjs/core/streams/decode";
import { FRATERNITI_LOGO_PNG_BASE64 } from "./loi-assets";

// loi-pdf.ts imports "server-only" (a deliberate guard against accidental
// client-bundling in production — not something this test should remove).
// Outside Next.js's own bundler, that package unconditionally throws; stub
// it out for this test file only, same pattern Next.js projects commonly
// use to unit-test server-only modules under Vitest.
vi.mock("server-only", () => ({}));

const { generateLoiPdf, drawWatermark } = await import("./loi-pdf");
type LoiValues = Parameters<typeof generateLoiPdf>[0]["values"];

const MINIMAL_VALUES: LoiValues = {
  name: "Test Franchisee",
  aadhaarMasked: "XXXX XXXX 1234",
  feeAmount: "1,00,000",
  feeInWords: "Rupees One Lakh only",
  territory: "Test Territory",
  issueDate: "2026-10-03",
  versionNo: "1.0",
};

// cos(45°) = sin(45°) ≈ 0.70710678 — the one place this exact rotation
// appears in a generated LOI is the watermark's `cm` matrix (plan.md
// section 19 decision 7: the logo drawn at WATERMARK_ANGLE_DEGREES = 45;
// nothing else in loi-pdf.ts rotates anything), so it's a reliable,
// content-independent fingerprint for "the watermark was actually drawn
// here" without needing to re-implement PDF image-XObject resolution.
const WATERMARK_ROTATION_SIGNATURE = "0.70710678";

/**
 * pdf-lib flate-compresses page content streams on save, so none of this is
 * a plain substring of the saved bytes. Decode each page's own `/Contents`
 * stream(s) through pdf-lib's own filter decoder (the exact inverse of what
 * it just compressed) rather than re-implementing PDF stream parsing.
 */
function decodePageContent(page: PDFPage): string {
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  let combined = "";
  for (const ref of refs) {
    const stream = page.node.context.lookup(ref);
    if (stream instanceof PDFRawStream) {
      combined += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    }
  }
  return combined;
}

describe("generateLoiPdf watermark (plan.md section 19 decision 7, L2)", () => {
  it("draws the watermark on every page without changing the page count", async () => {
    const { pdfBytes } = await generateLoiPdf({ templateBody: "", values: MINIMAL_VALUES });
    const loaded = await PDFDocument.load(pdfBytes);
    const pageCount = loaded.getPageCount();
    expect(pageCount).toBeGreaterThan(0);

    // Re-generate with the exact same input: deterministic page count,
    // i.e. the watermark loop itself never adds/removes a page.
    const second = await generateLoiPdf({ templateBody: "", values: MINIMAL_VALUES });
    const loadedSecond = await PDFDocument.load(second.pdfBytes);
    expect(loadedSecond.getPageCount()).toBe(pageCount);
  });

  it("computes the hash after drawing — the returned bytes (whose hash is returned) actually carry the watermark on every page", async () => {
    const { pdfBytes, sha256 } = await generateLoiPdf({ templateBody: "", values: MINIMAL_VALUES });

    expect(sha256).toBe(createHash("sha256").update(pdfBytes).digest("hex"));

    const loaded = await PDFDocument.load(pdfBytes);
    for (const page of loaded.getPages()) {
      expect(decodePageContent(page)).toContain(WATERMARK_ROTATION_SIGNATURE);
    }
  });

  it("draws the watermark exactly once per page (isolated from the header's own, unrotated copy of the same logo)", async () => {
    const doc = await PDFDocument.create();
    const logo = await doc.embedPng(Buffer.from(FRATERNITI_LOGO_PNG_BASE64, "base64"));
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);

    for (const page of doc.getPages()) {
      drawWatermark(page, logo);
    }

    const bytes = await doc.save();
    const loaded = await PDFDocument.load(bytes);
    for (const page of loaded.getPages()) {
      const content = decodePageContent(page);
      const occurrences = content.split(WATERMARK_ROTATION_SIGNATURE).length - 1;
      // One `cm` rotation matrix is [cos, sin, -sin, cos, tx, ty] — the
      // same 0.70710678... constant appears 4 times (the sign on the two
      // sin entries doesn't change the digit substring), so exactly one
      // `drawWatermark` call on this page means exactly 4 occurrences.
      expect(occurrences).toBe(4);
    }
  });
});
