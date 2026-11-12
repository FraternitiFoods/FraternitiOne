"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canEditOpsBoq } from "@/lib/permissions";
import { nextSno } from "@/lib/ops-boq-calc";
import { toOpsBoqRowView, type OpsBoqRowView } from "@/lib/ops-boq-data";
import {
  isOpsBoqEditableField,
  parseOpsBoqCell,
  parseOpsBoqName,
  type OpsBoqCellValue,
} from "@/lib/ops-boq-input";

/**
 * Operations BOQ writes (operations-boq-handoff.md sections 3, 6, 7).
 *
 * Every action re-checks the role on the server (the UI's disabled inputs are
 * a convenience, not the gate), validates the untrusted input, and writes the
 * row change + its AuditEvent in ONE transaction. Deliberately NOT gated by
 * checkModeAllowsWrite (Site BOQ's SHEET_LIVE/WEBSITE_LIVE switch): this module
 * is website-owned from day one and has no sheet.
 */
export type OpsBoqActionState = { error?: string; success?: boolean; row?: OpsBoqRowView; value?: OpsBoqCellValue };

const NO_PERMISSION = "You don't have permission to do this.";
const ENTITY_TYPE = "OpsBoqRow";

/** Stable string form of a stored cell for the audit log (dates as yyyy-mm-dd, money as numbers). */
function auditValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") return value.toNumber();
  return value as string | number;
}

/** Saves ONE cell. Returns the normalised stored value so the client can show exactly what was saved. */
export async function updateOpsBoqCell(rowId: string, field: string, value: unknown): Promise<OpsBoqActionState> {
  const user = await requireUser();
  if (!canEditOpsBoq(user)) return { error: NO_PERMISSION };

  if (typeof rowId !== "string" || typeof field !== "string" || !isOpsBoqEditableField(field)) {
    return { error: "Invalid request." };
  }
  const parsed = parseOpsBoqCell(field, value);
  if (!parsed.ok) return { error: parsed.error };

  const row = await db.opsBoqRow.findUnique({ where: { id: rowId }, include: { site: { select: { name: true } } } });
  if (!row) return { error: "This row no longer exists. Refresh the page." };

  const oldValue = auditValue(row[field]);
  const newValue = parsed.value;
  if (oldValue === newValue) return { success: true, value: newValue };

  const data = {
    [field]: field === "followUpDate" && typeof newValue === "string" ? new Date(`${newValue}T00:00:00.000Z`) : newValue,
    updatedById: user.id,
  };

  await db.$transaction(async (tx) => {
    await tx.opsBoqRow.update({ where: { id: rowId }, data });
    await writeAuditEvent(tx, {
      actor: user,
      entityType: ENTITY_TYPE,
      entityId: rowId,
      action: "UPDATE",
      oldValue: { [field]: oldValue },
      newValue: { [field]: newValue },
      reference: `${row.site.name} · ${row.name} · ${field}`,
    });
  });

  return { success: true, value: newValue };
}

/** Adds a row to ONE site only (never a global master add). S.No = max + 1. Admin/Operations only. */
export async function addOpsBoqRow(siteId: string, name: string): Promise<OpsBoqActionState> {
  const user = await requireUser();
  if (!canEditOpsBoq(user)) return { error: NO_PERMISSION };

  if (typeof siteId !== "string" || !siteId) return { error: "Invalid request." };
  const parsedName = parseOpsBoqName(name);
  if (!parsedName.ok) return { error: parsedName.error };

  const site = await db.site.findUnique({ where: { id: siteId }, select: { id: true, name: true } });
  if (!site) return { error: "Site not found." };

  const created = await db.$transaction(async (tx) => {
    const existing = await tx.opsBoqRow.findMany({
      where: { siteId },
      select: { name: true, sno: true, sortOrder: true },
    });
    if (existing.some((r) => r.name.toLowerCase() === parsedName.value.toLowerCase())) return null;

    const row = await tx.opsBoqRow.create({
      data: {
        siteId,
        isFixed: false,
        fixedKey: null,
        name: parsedName.value,
        sno: nextSno(existing.map((r) => r.sno)),
        sortOrder: existing.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1,
        updatedById: user.id,
      },
    });
    await writeAuditEvent(tx, {
      actor: user,
      entityType: ENTITY_TYPE,
      entityId: row.id,
      action: "CREATE",
      newValue: { name: row.name, sno: row.sno },
      reference: `${site.name} · ${row.name} · added row`,
    });
    return row;
  });

  if (!created) return { error: "This site already has a row with that name." };
  return { success: true, row: toOpsBoqRowView(created) };
}

/** Renames an ADDED row. Fixed rows are locked — refused here, not just hidden in the UI. */
export async function renameOpsBoqRow(rowId: string, name: string): Promise<OpsBoqActionState> {
  const user = await requireUser();
  if (!canEditOpsBoq(user)) return { error: NO_PERMISSION };

  if (typeof rowId !== "string" || !rowId) return { error: "Invalid request." };
  const parsedName = parseOpsBoqName(name);
  if (!parsedName.ok) return { error: parsedName.error };

  const row = await db.opsBoqRow.findUnique({ where: { id: rowId }, include: { site: { select: { name: true } } } });
  if (!row) return { error: "This row no longer exists. Refresh the page." };
  if (row.isFixed) return { error: "Fixed rows can't be renamed." };
  if (row.name === parsedName.value) return { success: true };

  const clash = await db.opsBoqRow.findFirst({
    where: { siteId: row.siteId, id: { not: rowId }, name: { equals: parsedName.value, mode: "insensitive" } },
    select: { id: true },
  });
  if (clash) return { error: "This site already has a row with that name." };

  await db.$transaction(async (tx) => {
    await tx.opsBoqRow.update({ where: { id: rowId }, data: { name: parsedName.value, updatedById: user.id } });
    await writeAuditEvent(tx, {
      actor: user,
      entityType: ENTITY_TYPE,
      entityId: rowId,
      action: "UPDATE",
      oldValue: { name: row.name },
      newValue: { name: parsedName.value },
      reference: `${row.site.name} · ${row.name} · name`,
    });
  });

  return { success: true };
}

/** Deletes an ADDED row. Fixed rows can never be deleted — refused here, not just hidden in the UI. */
export async function deleteOpsBoqRow(rowId: string): Promise<OpsBoqActionState> {
  const user = await requireUser();
  if (!canEditOpsBoq(user)) return { error: NO_PERMISSION };

  if (typeof rowId !== "string" || !rowId) return { error: "Invalid request." };

  const row = await db.opsBoqRow.findUnique({ where: { id: rowId }, include: { site: { select: { name: true } } } });
  if (!row) return { success: true }; // already gone — the end state the user asked for
  if (row.isFixed) return { error: "Fixed rows can't be deleted." };

  await db.$transaction(async (tx) => {
    await tx.opsBoqRow.deleteMany({ where: { id: rowId } });
    await writeAuditEvent(tx, {
      actor: user,
      entityType: ENTITY_TYPE,
      entityId: rowId,
      action: "DELETE",
      oldValue: { ...toOpsBoqRowView(row) },
      reference: `${row.site.name} · ${row.name} · deleted row`,
    });
  });

  return { success: true };
}
