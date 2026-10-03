"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canManageSales, canViewSales } from "@/lib/permissions";
import { validateSalesRow, dateKeyToDate, toUtcDateKey } from "@/lib/sales/parse-csv";

export type ActionState = { error?: string } | undefined;

async function loadProjectForSalesOrThrow(projectId: string) {
  const project = await db.franchiseProject.findUnique({
    where: { id: projectId },
    select: { id: true, franchiseeId: true, onboarding: { select: { salesOwnerId: true } } },
  });
  if (!project) throw new Error("Project not found.");
  return project;
}

const UpsertSalesDaySchema = z.object({
  date: z.string().trim().min(1, "Date is required."),
  grossSales: z.string().trim().min(1, "Gross sales is required."),
  netSales: z.string().trim().min(1, "Net sales is required."),
  orders: z.string().trim().min(1, "Orders is required."),
});

/**
 * SRD 10.2 fallback — Admin manually adds or edits one store-day. Reuses the
 * exact same row-rule function (`validateSalesRow`) the CSV importer uses,
 * so a manual entry can never slip past a rule the bulk importer enforces.
 * Upsert on `(projectId, date)` — editing an existing day overwrites it, and
 * the pre-edit values are captured in the audit event's `oldValue` before
 * being replaced (section 20A cause -> effect #2).
 */
export async function upsertSalesDay(
  projectId: string,
  redirectTo: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectForSalesOrThrow(projectId);

  if (!canViewSales(user, project)) {
    return { error: "Project not found." };
  }
  if (!canManageSales(user)) {
    return { error: "You don't have permission to edit sales." };
  }

  const parsed = UpsertSalesDaySchema.safeParse({
    date: formData.get("date"),
    grossSales: formData.get("grossSales"),
    netSales: formData.get("netSales"),
    orders: formData.get("orders"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const validated = validateSalesRow(parsed.data.date, parsed.data.grossSales, parsed.data.netSales, parsed.data.orders);
  if (!validated.ok) {
    return { error: validated.reason };
  }

  const dateValue = dateKeyToDate(validated.date);

  await db.$transaction(async (tx) => {
    const existing = await tx.salesDay.findUnique({
      where: { projectId_date: { projectId, date: dateValue } },
    });

    const saved = await tx.salesDay.upsert({
      where: { projectId_date: { projectId, date: dateValue } },
      create: {
        projectId,
        date: dateValue,
        grossSales: validated.grossSalesPaise,
        netSales: validated.netSalesPaise,
        orders: validated.orders,
        source: "MANUAL",
        createdById: user.id,
        updatedById: user.id,
      },
      update: {
        grossSales: validated.grossSalesPaise,
        netSales: validated.netSalesPaise,
        orders: validated.orders,
        source: "MANUAL",
        updatedById: user.id,
      },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "SalesDay",
      entityId: saved.id,
      action: existing ? "UPDATE" : "CREATE",
      oldValue: existing
        ? {
            date: toUtcDateKey(existing.date),
            grossSales: existing.grossSales,
            netSales: existing.netSales,
            orders: existing.orders,
            source: existing.source,
          }
        : null,
      newValue: {
        date: toUtcDateKey(saved.date),
        grossSales: saved.grossSales,
        netSales: saved.netSales,
        orders: saved.orders,
        source: saved.source,
      },
      reference: existing ? "Manual edit" : "Manual add",
    });
  });

  redirect(redirectTo);
}
