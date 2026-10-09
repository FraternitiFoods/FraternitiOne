import { describe, it, expect, vi } from "vitest";
import { PDFDocument, PDFArray, PDFRawStream, type PDFPage } from "pdf-lib";
import { decodePDFRawStream } from "pdf-lib/cjs/core/streams/decode";
import type { BoardSummary } from "./board-summary";

// board-digest-pdf.ts and pdf-utils.ts both import "server-only" — same
// Vitest-under-Next.js stub pattern already used by loi-pdf.test.ts.
vi.mock("server-only", () => ({}));

const { generateBoardDigestPdf } = await import("./board-digest-pdf");

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

/**
 * pdf-lib's `drawText` emits each string as a `<HEX>` show-text operand
 * (`Tj`), not a literal `(text)` one — so a drawn sentence never appears as
 * a plain substring of the decoded content stream. Decode every `<HEX> Tj`
 * operand back to text and join them, same spirit as loi-pdf.test.ts
 * decoding the stream's own compression rather than re-implementing it.
 */
function extractDrawnText(page: PDFPage): string {
  const content = decodePageContent(page);
  const matches = content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g);
  return Array.from(matches)
    .map((m) => Buffer.from(m[1], "hex").toString("latin1"))
    .join(" ");
}

const BASE_SUMMARY: BoardSummary = {
  generatedAt: new Date("2026-10-13T04:00:00.000Z"),
  health: { total: 12, onTrack: 7, atRisk: 3, critical: 2 },
  onboarding: {
    totalOnboardings: 9,
    salesUsers: 4,
    kycPending: 2,
    kycAccepted: 7,
    loiPending: 1,
    loiComplete: 8,
    openComplaints: 5,
    salesThisMonth: { grossSales: 1_000_000, netSales: 900_000, orders: 42 },
    kycQueueSize: 1,
    paymentQueueSize: 0,
  },
  delays: {
    runningOnTrack: 20,
    runningOverdue: 6,
    finishedOnTime: 30,
    finishedLate: 4,
    averageDaysOverdue: 3.5,
    byDepartment: [],
    byStage: [],
    topLate: [
      {
        id: "t1",
        title: "Pour foundation",
        module: "INTERIORS",
        lifecycleStage: "CONSTRUCTION_EXECUTION",
        status: "IN_PROGRESS",
        dueDate: new Date("2026-10-01"),
        startedAt: null,
        completedAt: null,
        slaDays: null,
        ownerName: "Test Owner",
        daysOverdue: 9,
        storeLabel: "Tulsi, Indore",
      },
    ],
  },
};

describe("generateBoardDigestPdf", () => {
  it("produces a valid, loadable PDF with at least one page", async () => {
    const bytes = await generateBoardDigestPdf(BASE_SUMMARY);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(0);
  });

  it("renders the key figures and the top-overdue row onto the page content", async () => {
    const bytes = await generateBoardDigestPdf(BASE_SUMMARY);
    const loaded = await PDFDocument.load(bytes);
    const content = loaded.getPages().map(extractDrawnText).join("\n");

    expect(content).toContain("Weekly Board Summary");
    expect(content).toContain("12"); // active projects
    expect(content).toContain("Tulsi, Indore");
    expect(content).toContain("Pour foundation");
  });

  it("renders a fallback line instead of crashing when nothing is overdue", async () => {
    const empty: BoardSummary = { ...BASE_SUMMARY, delays: { ...BASE_SUMMARY.delays, topLate: [] } };
    const bytes = await generateBoardDigestPdf(empty);
    const loaded = await PDFDocument.load(bytes);
    const content = loaded.getPages().map(extractDrawnText).join("\n");
    expect(content).toContain("Nothing overdue right now.");
  });
});
