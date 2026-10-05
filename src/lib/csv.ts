/**
 * plan.md section 20D: exported CSVs must be UTF-8 with a BOM (so Excel
 * renders Indian names correctly instead of guessing the wrong codepage) and
 * must prefix any cell starting with `= + - @` with a leading `'` so a
 * spreadsheet app never evaluates exported data as a formula.
 */
const BOM = "﻿";
const FORMULA_PREFIXES = ["=", "+", "-", "@"];

function csvCell(value: string): string {
  const safe = FORMULA_PREFIXES.some((p) => value.startsWith(p)) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}
