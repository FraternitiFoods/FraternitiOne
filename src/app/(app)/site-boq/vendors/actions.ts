"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canEditVendors } from "@/lib/permissions";
import { checkModeAllowsWrite } from "@/lib/site-boq-write-guard";

export type ActionState = { error?: string; success?: boolean } | undefined;

const nullableTextSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const VendorSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  address: nullableTextSchema,
  gstin: nullableTextSchema,
  phone: nullableTextSchema,
  email: nullableTextSchema,
  note: nullableTextSchema,
});

/**
 * plan.md section 4.4 — vendor contact details, Admin only, allowed in
 * either mode (the "vendor" write area is mode-exempt — plan.md section 1:
 * the sheet has no data for these fields, so import never overwrites them).
 */
export async function updateVendor(
  vendorId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditVendors(user)) return { error: "You don't have permission to do this." };

  const modeCheck = await checkModeAllowsWrite("vendor");
  if (!modeCheck.ok) return { error: modeCheck.error };

  const existing = await db.vendor.findUnique({ where: { id: vendorId } });
  if (!existing) return { error: "Vendor not found." };

  const parsed = VendorSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    gstin: formData.get("gstin"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  if (data.name !== existing.name) {
    const nameTaken = await db.vendor.findFirst({ where: { name: data.name, id: { not: vendorId } } });
    if (nameTaken) return { error: "A vendor with this name already exists." };
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.vendor.update({ where: { id: vendorId }, data });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "Vendor",
      entityId: updated.id,
      action: "UPDATE",
      oldValue: {
        name: existing.name,
        address: existing.address,
        gstin: existing.gstin,
        phone: existing.phone,
        email: existing.email,
        note: existing.note,
      },
      newValue: data,
      reference: "Updated via Site BOQ vendor management",
    });
  });

  revalidatePath("/site-boq/vendors");
  return { success: true };
}
