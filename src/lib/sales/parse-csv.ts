/**
 * plan.md section 20A — pure, DB-free CSV parsing for the sales importer.
 * No `server-only` import on purpose, same reasoning as
 * src/lib/onboarding/state.ts: this module takes a plain string in and
 * returns plain data out, so it's unit-testable without a database and the
 * DB-touching caller (dry-run preview / confirm-import server actions) stays
 * a thin wrapper around it.
 *
 * Header -> field mapping is config, not code (section 20A instruction): to
 * support a different POS export's column names later, add aliases below —
 * no parsing logic should need to change. The default layout is our own
 * template (date,gross_sales,net_sales,orders) — a real Petpooja/POS export
 * sample was not available when this was built (plan.md section 20
 * "NOT DECIDED YET" #1), so the exact column names/semantics of Gross vs Net
 * are [unconfirmed] until Apoorv provides one.
 *
 * `validateSalesRow` is also used directly by the manual single-day entry
 * form (src/app/(app)/sales/actions.ts) — one set of row rules for both
 * paths, not two that could drift apart.
 */

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB (section 20A file cap)
export const MAX_ROWS = 5000; // section 20A row cap

type CanonicalField = "date" | "grossSales" | "netSales" | "orders";

/**
 * Header aliases, case/space/punctuation-insensitive (compared after
 * `normalizeHeaderCell`). Add a new array entry here to support another
 * export layout's column name without touching any parsing code below.
 */
const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  date: ["date", "business_date", "sales_date"],
  grossSales: ["gross_sales", "gross", "gross_amount", "total_sales"],
  netSales: ["net_sales", "net", "net_amount"],
  orders: ["orders", "order_count", "no_of_orders", "num_orders", "bill_count"],
};

function normalizeHeaderCell(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Minimal CSV line splitter — supports double-quoted cells (with "" as an
 * escaped quote) so a stray comma or quote in a value doesn't break parsing.
 * The template is pure numeric/date data, but POS exports vary, so this is
 * a little more defensive than `split(",")`.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function splitLines(content: string): string[] {
  // Normalize CRLF/CR to LF, then drop trailing blank lines (a trailing
  // newline at EOF shouldn't count as an extra empty data row).
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines;
}

/** `now` -> its UTC calendar date as `YYYY-MM-DD`. */
export function toUtcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * `YYYY-MM-DD` -> a `Date` at UTC midnight, for writing to the `@db.Date`
 * `SalesDay.date` column. Always goes through this one helper (never
 * `new Date(dateKey)`, which is timezone-sensitive in a browser context and
 * easy to get subtly wrong) so every write and every `toUtcDateKey` read
 * round-trips the same calendar date regardless of server timezone.
 */
export function dateKeyToDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * `YYYY-MM-DD` or `DD/MM/YYYY` only (section 20A). Returns the canonical
 * `YYYY-MM-DD` string, or null if the text isn't a real calendar date (e.g.
 * `31/02/2026`) — constructing a UTC date and checking the components
 * round-trip catches month/day overflow that a naive regex alone wouldn't.
 */
function parseFlexibleDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
  } else {
    return null;
  }

  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Rupees (as text, optional thousands commas, up to 2 decimal places) ->
 * integer paise. Deliberately does all arithmetic on integer strings, never
 * `parseFloat(...) * 100` — that's the exact float-precision trap section
 * 20A's own money rule exists to avoid (plan.md section 17: "money is
 * integer paise, never float"). Returns null for anything that isn't a
 * plain non-negative number (negative sign, letters, etc.) — the caller
 * reports a specific reason for a negative value vs. a malformed one.
 */
function rupeesToPaise(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [intPart, decPart = ""] = cleaned.split(".");
  const paddedDec = (decPart + "00").slice(0, 2);
  return Number(intPart) * 100 + Number(paddedDec);
}

function parseMoneyCell(raw: string): number | null | "negative" {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-")) return "negative";
  return rupeesToPaise(trimmed);
}

export type SalesRowValidationResult =
  | { ok: true; date: string; grossSalesPaise: number; netSalesPaise: number; orders: number }
  | { ok: false; reason: string };

/**
 * The single row-rule set for sales data, shared by the CSV importer (one
 * call per data line) and the Admin manual single-day form (one call per
 * submit) — section 20A's row rules: reject future dates, negative amounts,
 * non-integer orders, `net > gross` [default, confirm — see module comment].
 */
export function validateSalesRow(
  dateRaw: string,
  grossRaw: string,
  netRaw: string,
  ordersRaw: string,
  now: Date = new Date()
): SalesRowValidationResult {
  const todayIso = toUtcDateKey(now);

  const date = parseFlexibleDate(dateRaw);
  if (!date) {
    return { ok: false, reason: `Invalid date "${dateRaw}" — use YYYY-MM-DD or DD/MM/YYYY.` };
  }
  // "Today" compared in UTC calendar terms — an IST-exact business-day
  // boundary is a known simplification, same [unconfirmed] bucket as the
  // column layout itself (plan.md section 20 "NOT DECIDED YET" #1).
  if (date > todayIso) {
    return { ok: false, reason: `Future date (${date}) is not allowed.` };
  }

  const grossSalesPaise = parseMoneyCell(grossRaw);
  if (grossSalesPaise === "negative") {
    return { ok: false, reason: "Gross sales cannot be negative." };
  }
  if (grossSalesPaise === null) {
    return { ok: false, reason: `Invalid gross sales amount "${grossRaw}".` };
  }

  const netSalesPaise = parseMoneyCell(netRaw);
  if (netSalesPaise === "negative") {
    return { ok: false, reason: "Net sales cannot be negative." };
  }
  if (netSalesPaise === null) {
    return { ok: false, reason: `Invalid net sales amount "${netRaw}".` };
  }

  const ordersTrimmed = ordersRaw.trim();
  if (ordersTrimmed.startsWith("-")) {
    return { ok: false, reason: "Orders cannot be negative." };
  }
  if (!/^\d+$/.test(ordersTrimmed)) {
    return { ok: false, reason: `Orders must be a whole number, got "${ordersRaw}".` };
  }
  const orders = Number(ordersTrimmed);

  // [unconfirmed default, section 20A]: net > gross is rejected rather than
  // accepted — flagged as a "confirm" item in plan.md, not re-asked here.
  if (netSalesPaise > grossSalesPaise) {
    return { ok: false, reason: "Net sales cannot exceed gross sales." };
  }

  return { ok: true, date, grossSalesPaise, netSalesPaise, orders };
}

export type ParsedSalesRow = {
  /** 1-based line number in the file, including the header row (so row 2 is the first data row). */
  line: number;
  /** Canonical YYYY-MM-DD. */
  date: string;
  grossSalesPaise: number;
  netSalesPaise: number;
  orders: number;
};

export type RejectedSalesRow = {
  line: number;
  reason: string;
};

export type ParseSalesCsvResult =
  | {
      ok: true;
      rowsRead: number;
      validRows: ParsedSalesRow[];
      rejectedRows: RejectedSalesRow[];
      /** Dates that appear on more than one valid row in this file — see `dedupeByDate`. */
      duplicateDates: string[];
    }
  | { ok: false; error: string };

export type ParseSalesCsvOptions = {
  /** Clock used for the "reject future dates" rule — injected so tests are deterministic. */
  now?: Date;
};

export function parseSalesCsv(content: string, options: ParseSalesCsvOptions = {}): ParseSalesCsvResult {
  const now = options.now ?? new Date();

  const lines = splitLines(content);
  if (lines.length === 0) {
    return { ok: false, error: "The file is empty." };
  }

  const headerCells = splitCsvLine(lines[0]).map(normalizeHeaderCell);
  const columnIndex: Partial<Record<CanonicalField, number>> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [CanonicalField, string[]][]) {
    const normalizedAliases = aliases.map(normalizeHeaderCell);
    const idx = headerCells.findIndex((cell) => normalizedAliases.includes(cell));
    if (idx >= 0) columnIndex[field] = idx;
  }

  const missing = (["date", "grossSales", "netSales", "orders"] as CanonicalField[]).filter(
    (f) => columnIndex[f] === undefined
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required column(s): ${missing.join(", ")}. Expected headers like date,gross_sales,net_sales,orders.`,
    };
  }

  const dataLines = lines.slice(1).filter((line) => line.trim() !== "");
  const rowsRead = dataLines.length;
  if (rowsRead === 0) {
    return { ok: false, error: "The file has a header row but no data rows." };
  }
  if (rowsRead > MAX_ROWS) {
    return { ok: false, error: `Too many rows: ${rowsRead} (max ${MAX_ROWS}).` };
  }

  const validRows: ParsedSalesRow[] = [];
  const rejectedRows: RejectedSalesRow[] = [];
  const dateCounts = new Map<string, number>();

  dataLines.forEach((line, i) => {
    const lineNumber = i + 2; // +1 for header, +1 for 1-based numbering
    const cells = splitCsvLine(line);

    const dateRaw = cells[columnIndex.date!] ?? "";
    const grossRaw = cells[columnIndex.grossSales!] ?? "";
    const netRaw = cells[columnIndex.netSales!] ?? "";
    const ordersRaw = cells[columnIndex.orders!] ?? "";

    const result = validateSalesRow(dateRaw, grossRaw, netRaw, ordersRaw, now);
    if (!result.ok) {
      rejectedRows.push({ line: lineNumber, reason: result.reason });
      return;
    }

    dateCounts.set(result.date, (dateCounts.get(result.date) ?? 0) + 1);
    validRows.push({
      line: lineNumber,
      date: result.date,
      grossSalesPaise: result.grossSalesPaise,
      netSalesPaise: result.netSalesPaise,
      orders: result.orders,
    });
  });

  const duplicateDates = Array.from(dateCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([date]) => date);

  return { ok: true, rowsRead, validRows, rejectedRows, duplicateDates };
}

/**
 * Collapses rows sharing the same date down to one, last occurrence wins
 * (matches the DB-level `(projectId, date)` unique upsert: whichever row for
 * a given date appears last in the file is what ends up on disk). Separate
 * from `parseSalesCsv` so the preview can show duplicate-date rows as plain
 * data alongside the final deduped set.
 */
export function dedupeByDate(rows: ParsedSalesRow[]): ParsedSalesRow[] {
  const byDate = new Map<string, ParsedSalesRow>();
  for (const row of rows) {
    byDate.set(row.date, row);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Template CSV offered on `/sales/import` — our own layout (section 20A default), not a real POS export. */
export const SALES_CSV_TEMPLATE = `date,gross_sales,net_sales,orders\n2026-09-01,45000,42000,180\n`;
