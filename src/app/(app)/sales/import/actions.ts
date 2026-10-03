"use server";

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canManageSales } from "@/lib/permissions";
import { dateKeyToDate, dedupeByDate, parseSalesCsv, toUtcDateKey, MAX_FILE_SIZE_BYTES } from "@/lib/sales/parse-csv";

async function loadProjectOrThrow(projectId: string) {
  const project = await db.franchiseProject.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found.");
  return project;
}

export type PreviewRowView = {
  date: string;
  grossSales: number;
  netSales: number;
  orders: number;
  status: "new" | "changed" | "unchanged";
};

export type SalesImportPreview = {
  fileName: string;
  fileSha256: string;
  rowsRead: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  rejectedCount: number;
  duplicateDatesCount: number;
  sampleRows: PreviewRowView[];
  rejectedRows: { line: number; reason: string }[];
};

export type PreviewResult = { ok: true; preview: SalesImportPreview } | { ok: false; error: string };

async function readAndParseFile(
  formData: FormData,
  now: Date
): Promise<
  | { ok: true; buffer: Buffer; parsed: Extract<ReturnType<typeof parseSalesCsv>, { ok: true }> }
  | { ok: false; error: string }
> {
  const fileValue = formData.get("file");
  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return { ok: false, error: "Choose a CSV file." };
  }
  if (fileValue.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `File is too large — max ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.` };
  }

  const buffer = Buffer.from(await fileValue.arrayBuffer());
  const text = buffer.toString("utf-8");
  const parsed = parseSalesCsv(text, { now });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, buffer, parsed };
}

/**
 * Dry run — reads and validates the file, diffs it against what's already on
 * disk, and returns counts/sample rows. Writes nothing (section 20A cause ->
 * effect #2: "Nothing is written until the user confirms the preview").
 */
export async function previewSalesImport(projectId: string, formData: FormData): Promise<PreviewResult> {
  const user = await requireUser();
  if (!canManageSales(user)) {
    return { ok: false, error: "You don't have permission to import sales." };
  }
  await loadProjectOrThrow(projectId);

  const read = await readAndParseFile(formData, new Date());
  if (!read.ok) return read;
  const { buffer, parsed } = read;

  const deduped = dedupeByDate(parsed.validRows);
  const existing = await db.salesDay.findMany({
    where: { projectId, date: { in: deduped.map((r) => dateKeyToDate(r.date)) } },
  });
  const existingByDate = new Map(existing.map((e) => [toUtcDateKey(e.date), e]));

  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  const sampleRows: PreviewRowView[] = [];

  for (const row of deduped) {
    const prev = existingByDate.get(row.date);
    let status: PreviewRowView["status"];
    if (!prev) {
      status = "new";
      newCount++;
    } else if (prev.grossSales === row.grossSalesPaise && prev.netSales === row.netSalesPaise && prev.orders === row.orders) {
      status = "unchanged";
      unchangedCount++;
    } else {
      status = "changed";
      changedCount++;
    }
    if (sampleRows.length < 25) {
      sampleRows.push({ date: row.date, grossSales: row.grossSalesPaise, netSales: row.netSalesPaise, orders: row.orders, status });
    }
  }

  const fileSha256 = createHash("sha256").update(buffer).digest("hex");
  const fileValue = formData.get("file") as File;

  return {
    ok: true,
    preview: {
      fileName: fileValue.name,
      fileSha256,
      rowsRead: parsed.rowsRead,
      newCount,
      changedCount,
      unchangedCount,
      rejectedCount: parsed.rejectedRows.length,
      duplicateDatesCount: parsed.duplicateDates.length,
      sampleRows,
      rejectedRows: parsed.rejectedRows.slice(0, 25),
    },
  };
}

export type ConfirmResult = { ok: true; inserted: number; updated: number; rejected: number } | { ok: false; error: string };

/**
 * Re-parses the same file (the client resubmits it — nothing from the dry
 * run is trusted or persisted server-side between the two calls) and writes
 * every valid, deduped row in one transaction, upserting on
 * `(projectId, date)` so a re-import of the same file is a no-op on the
 * second pass: unchanged rows are skipped entirely (no write at all), so
 * totals come out identical and nothing double-counts (section 20A cause ->
 * effect #1). One AuditEvent summarizes the whole batch (counts + file
 * hash), with every changed day's old -> new values attached to it.
 */
export async function confirmSalesImport(projectId: string, formData: FormData): Promise<ConfirmResult> {
  const user = await requireUser();
  if (!canManageSales(user)) {
    return { ok: false, error: "You don't have permission to import sales." };
  }
  await loadProjectOrThrow(projectId);

  const read = await readAndParseFile(formData, new Date());
  if (!read.ok) return read;
  const { buffer, parsed } = read;
  const fileValue = formData.get("file") as File;

  const deduped = dedupeByDate(parsed.validRows);
  const fileSha256 = createHash("sha256").update(buffer).digest("hex");

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.salesDay.findMany({
      where: { projectId, date: { in: deduped.map((r) => dateKeyToDate(r.date)) } },
    });
    const existingByDate = new Map(existing.map((e) => [toUtcDateKey(e.date), e]));

    let inserted = 0;
    let updated = 0;
    const touchedDates: string[] = [];
    // Section 20A cause -> effect #2: "overwritten days keep their old
    // values in the audit event" — captured here (one batch-level audit
    // event, not one per SalesDay row) rather than only on the manual-edit
    // path, so a CSV re-import that changes a day's numbers is traceable
    // too. Capped so one giant file can't blow up the audit payload.
    const MAX_CHANGED_IN_AUDIT = 50;
    const changedRowsForAudit: {
      date: string;
      oldValue: { grossSales: number; netSales: number; orders: number };
      newValue: { grossSales: number; netSales: number; orders: number };
    }[] = [];

    for (const row of deduped) {
      const prev = existingByDate.get(row.date);
      if (prev && prev.grossSales === row.grossSalesPaise && prev.netSales === row.netSalesPaise && prev.orders === row.orders) {
        continue; // unchanged — no write, no churn on updatedAt/updatedById
      }
      if (prev && changedRowsForAudit.length < MAX_CHANGED_IN_AUDIT) {
        changedRowsForAudit.push({
          date: row.date,
          oldValue: { grossSales: prev.grossSales, netSales: prev.netSales, orders: prev.orders },
          newValue: { grossSales: row.grossSalesPaise, netSales: row.netSalesPaise, orders: row.orders },
        });
      }

      const dateValue = dateKeyToDate(row.date);
      await tx.salesDay.upsert({
        where: { projectId_date: { projectId, date: dateValue } },
        create: {
          projectId,
          date: dateValue,
          grossSales: row.grossSalesPaise,
          netSales: row.netSalesPaise,
          orders: row.orders,
          source: "CSV",
          createdById: user.id,
          updatedById: user.id,
        },
        update: {
          grossSales: row.grossSalesPaise,
          netSales: row.netSalesPaise,
          orders: row.orders,
          source: "CSV",
          updatedById: user.id,
        },
      });

      touchedDates.push(row.date);
      if (prev) updated++;
      else inserted++;
    }

    const batch = await tx.salesImportBatch.create({
      data: {
        projectId,
        fileName: fileValue.name,
        fileSha256,
        rowsRead: parsed.rowsRead,
        rowsInserted: inserted,
        rowsUpdated: updated,
        rowsRejected: parsed.rejectedRows.length,
        errors: parsed.rejectedRows,
        createdById: user.id,
      },
    });

    // Link every row this batch actually inserted/updated back to it, so
    // SalesImportBatch.days reflects exactly what this confirm wrote —
    // unchanged rows are skipped above and keep whichever batch they
    // already pointed at, since nothing about them changed.
    if (touchedDates.length > 0) {
      await tx.salesDay.updateMany({
        where: { projectId, date: { in: touchedDates.map((d) => dateKeyToDate(d)) } },
        data: { importBatchId: batch.id },
      });
    }

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "SalesImportBatch",
      entityId: batch.id,
      action: "CREATE",
      newValue: {
        fileName: fileValue.name,
        fileSha256,
        rowsRead: parsed.rowsRead,
        rowsInserted: inserted,
        rowsUpdated: updated,
        rowsRejected: parsed.rejectedRows.length,
        changedRows: changedRowsForAudit,
      },
      reference: `CSV import: ${fileValue.name}`,
    });

    return { inserted, updated, rejected: parsed.rejectedRows.length };
  });

  return { ok: true, ...result };
}
