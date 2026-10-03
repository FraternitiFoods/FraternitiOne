import { describe, expect, it } from "vitest";
import { parseSalesCsv, dedupeByDate, MAX_ROWS, type ParsedSalesRow } from "./parse-csv";

const NOW = new Date("2026-10-01T12:00:00.000Z");

const HEADER = "date,gross_sales,net_sales,orders";

function csv(rows: string[], header = HEADER): string {
  return [header, ...rows].join("\n");
}

describe("parseSalesCsv", () => {
  it("parses good rows and converts rupees to integer paise", () => {
    const result = parseSalesCsv(csv(["2026-09-01,45000,42000,180", "2026-09-02,1234.50,1000.25,10"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowsRead).toBe(2);
    expect(result.rejectedRows).toHaveLength(0);
    expect(result.validRows).toEqual<ParsedSalesRow[]>([
      { line: 2, date: "2026-09-01", grossSalesPaise: 4_500_000, netSalesPaise: 4_200_000, orders: 180 },
      { line: 3, date: "2026-09-02", grossSalesPaise: 123_450, netSalesPaise: 100_025, orders: 10 },
    ]);
  });

  it("accepts DD/MM/YYYY dates alongside ISO dates", () => {
    const result = parseSalesCsv(csv(["01/09/2026,1000,900,5", "2026-09-02,1000,900,5"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validRows.map((r) => r.date)).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("is case/space-insensitive on headers and tolerates alias column names", () => {
    const result = parseSalesCsv(csv(["2026-09-01,1000,900,5"], "Date, Gross Sales ,NET_SALES,Orders"), { now: NOW });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-existent calendar date", () => {
    const result = parseSalesCsv(csv(["31/02/2026,1000,900,5"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validRows).toHaveLength(0);
    expect(result.rejectedRows[0].reason).toMatch(/invalid date/i);
  });

  it("rejects a future date", () => {
    const result = parseSalesCsv(csv(["2026-10-05,1000,900,5"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validRows).toHaveLength(0);
    expect(result.rejectedRows[0].reason).toMatch(/future date/i);
  });

  it("accepts today's date (not strictly in the future)", () => {
    const result = parseSalesCsv(csv(["2026-10-01,1000,900,5"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validRows).toHaveLength(1);
    expect(result.rejectedRows).toHaveLength(0);
  });

  it("rejects a negative gross amount", () => {
    const result = parseSalesCsv(csv(["2026-09-01,-500,100,5"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejectedRows[0].reason).toMatch(/gross sales cannot be negative/i);
  });

  it("rejects a negative net amount", () => {
    const result = parseSalesCsv(csv(["2026-09-01,500,-100,5"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejectedRows[0].reason).toMatch(/net sales cannot be negative/i);
  });

  it("rejects non-integer orders", () => {
    const result = parseSalesCsv(csv(["2026-09-01,500,400,5.5"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejectedRows[0].reason).toMatch(/whole number/i);
  });

  it("rejects negative orders", () => {
    const result = parseSalesCsv(csv(["2026-09-01,500,400,-2"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejectedRows[0].reason).toMatch(/orders cannot be negative/i);
  });

  it("rejects net sales greater than gross sales", () => {
    const result = parseSalesCsv(csv(["2026-09-01,400,500,5"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejectedRows[0].reason).toMatch(/net sales cannot exceed gross sales/i);
  });

  it("isolates one bad row without dropping the good ones around it", () => {
    const result = parseSalesCsv(
      csv(["2026-09-01,1000,900,5", "2026-09-02,-100,50,3", "2026-09-03,2000,1800,12"]),
      { now: NOW }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validRows).toHaveLength(2);
    expect(result.rejectedRows).toHaveLength(1);
    expect(result.rejectedRows[0].line).toBe(3);
  });

  it("flags duplicate dates inside one file without dropping either row", () => {
    const result = parseSalesCsv(csv(["2026-09-01,1000,900,5", "2026-09-01,1100,950,6"]), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validRows).toHaveLength(2);
    expect(result.duplicateDates).toEqual(["2026-09-01"]);
  });

  it("rejects an empty file", () => {
    const result = parseSalesCsv("", { now: NOW });
    expect(result.ok).toBe(false);
  });

  it("rejects a header-only file (no data rows)", () => {
    const result = parseSalesCsv(HEADER, { now: NOW });
    expect(result.ok).toBe(false);
  });

  it("rejects a file missing a required column", () => {
    const result = parseSalesCsv(csv(["2026-09-01,1000,5"], "date,gross_sales,orders"), { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/missing required column/i);
  });

  it("rejects a file over the row cap", () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, () => `2026-09-01,100,90,1`);
    const result = parseSalesCsv(csv(rows), { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too many rows/i);
  });
});

describe("dedupeByDate", () => {
  it("keeps the last occurrence of a repeated date (matches the DB upsert semantics)", () => {
    const rows: ParsedSalesRow[] = [
      { line: 2, date: "2026-09-01", grossSalesPaise: 1000, netSalesPaise: 900, orders: 5 },
      { line: 3, date: "2026-09-01", grossSalesPaise: 1100, netSalesPaise: 950, orders: 6 },
      { line: 4, date: "2026-09-02", grossSalesPaise: 2000, netSalesPaise: 1800, orders: 10 },
    ];
    const deduped = dedupeByDate(rows);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((r) => r.date === "2026-09-01")).toEqual(rows[1]);
  });

  it("is a no-op when every date is already unique", () => {
    const rows: ParsedSalesRow[] = [
      { line: 2, date: "2026-09-01", grossSalesPaise: 1000, netSalesPaise: 900, orders: 5 },
      { line: 3, date: "2026-09-02", grossSalesPaise: 2000, netSalesPaise: 1800, orders: 10 },
    ];
    expect(dedupeByDate(rows)).toEqual(rows);
  });
});
