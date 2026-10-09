import "server-only";

import { PDFDocument, PDFFont, PDFPage, StandardFonts } from "pdf-lib";
import { MARGIN, CONTENT_WIDTH, PAGE_WIDTH, PAGE_HEIGHT, toWinAnsiSafe, wrapText } from "@/lib/pdf-utils";
import { formatPaiseAsRupees } from "@/lib/sales/format";
import { DEPARTMENT_LABELS } from "@/lib/format";
import type { BoardSummary } from "@/lib/board-summary";

/**
 * Weekly board digest — the same `BoardSummary` the /board screen renders,
 * laid out as plain text rows on A4 pages via pdf-lib (same serverless-safe,
 * no-headless-Chrome constraint as onboarding/loi-pdf.ts, plan.md section
 * 12). No table/chart library — simple "label: value" rows and a short
 * bullet list, which is all this content needs.
 */
export async function generateBoardDigestPdf(summary: BoardSummary): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function newPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) newPage();
  }

  function drawHeading(text: string, size = 14) {
    ensureSpace(size + 10);
    page.drawText(toWinAnsiSafe(text), { x: MARGIN, y, size, font: boldFont as PDFFont });
    y -= size + 10;
  }

  function drawLine(text: string, opts: { size?: number; indent?: number } = {}) {
    const size = opts.size ?? 11;
    const indent = opts.indent ?? 0;
    const lines = wrapText(toWinAnsiSafe(text), font, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      ensureSpace(size + 4);
      page.drawText(line, { x: MARGIN + indent, y, size, font });
      y -= size + 4;
    }
  }

  drawHeading("Fraterniti One - Weekly Board Summary", 16);
  drawLine(`Generated: ${summary.generatedAt.toISOString().slice(0, 10)}`, { size: 9 });
  y -= 10;

  drawHeading("Portfolio Health");
  drawLine(`Active projects: ${summary.health.total}`);
  drawLine(`On track (green): ${summary.health.onTrack}`);
  drawLine(`At risk (amber): ${summary.health.atRisk}`);
  drawLine(`Critical: ${summary.health.critical}`);
  y -= 10;

  drawHeading("Onboarding Pipeline");
  drawLine(`Total onboardings: ${summary.onboarding.totalOnboardings}`);
  drawLine(`KYC pending: ${summary.onboarding.kycPending}`);
  drawLine(`LOI pending: ${summary.onboarding.loiPending}`);
  drawLine(`Open complaints: ${summary.onboarding.openComplaints}`);
  y -= 10;

  drawHeading("Revenue");
  drawLine(`Sales this month (net, portfolio-wide): ${formatPaiseAsRupees(summary.onboarding.salesThisMonth.netSales)}`);
  drawLine(`Orders this month: ${summary.onboarding.salesThisMonth.orders}`);
  y -= 10;

  drawHeading("Delivery & Delays");
  drawLine(`Running on time: ${summary.delays.runningOnTrack}`);
  drawLine(`Running overdue: ${summary.delays.runningOverdue}`);
  drawLine(`Finished on time: ${summary.delays.finishedOnTime}`);
  drawLine(`Finished late: ${summary.delays.finishedLate}`);
  drawLine(`Average days overdue (open overdue tasks): ${summary.delays.averageDaysOverdue}`);
  y -= 6;

  if (summary.delays.topLate.length > 0) {
    drawLine("Most overdue right now:");
    for (const t of summary.delays.topLate) {
      drawLine(`- ${t.storeLabel} - ${t.title} (${DEPARTMENT_LABELS[t.module]}, ${t.daysOverdue}d late)`, {
        indent: 12,
        size: 10,
      });
    }
  } else {
    drawLine("Nothing overdue right now.", { indent: 12 });
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
