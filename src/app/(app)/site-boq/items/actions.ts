"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canEditSiteItemTracking, canEditItems, canEditRateOverride } from "@/lib/permissions";
import { checkModeAllowsWrite, isSiteItemEditableForLock } from "@/lib/site-boq-write-guard";
import { decToNumber } from "@/lib/boq-calc";

export type ActionState = { error?: string; success?: boolean } | undefined;

const nullableTextSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const nullableNumberSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.coerce.number().nullable()
);

function revalidateBoqPages() {
  revalidatePath("/site-boq");
  revalidatePath("/site-boq/site-view");
  revalidatePath("/site-boq/items");
}

/**
 * Shared by every SiteItem field-edit action below: a caller-supplied
 * permission check (role varies — qty/remark/tracking allow every internal
 * role, rate_override is Admin only), mode (section 1) and the Site lock gate
 * (sections 3/5 — nobody, not even Admin, edits a locked site's qty/remark/
 * rateOverride/tracking fields). Returns the Site row too since callers need
 * its name for the audit reference.
 */
async function guardSiteWrite(
  siteId: string,
  hasPermission: boolean
): Promise<{ ok: true; site: { id: string; name: string } } | { ok: false; error: string }> {
  if (!hasPermission) {
    return { ok: false, error: "You don't have permission to edit this." };
  }

  const modeCheck = await checkModeAllowsWrite("siteItem");
  if (!modeCheck.ok) return modeCheck;

  const site = await db.site.findUnique({ where: { id: siteId } });
  if (!site) return { ok: false, error: "Site not found." };

  const lockCheck = isSiteItemEditableForLock(site);
  if (!lockCheck.ok) return lockCheck;

  return { ok: true, site };
}

/**
 * plan.md section 4.3 "inline qty edit" + section 5 row 2. Qty and remark/
 * size are separate actions (not one combined form) so each table cell can
 * be its own independent inline-edit `<form>` — HTML doesn't let one `<form>`
 * span two `<td>`s. Upserts the SiteItem row since plan.md section 3 only
 * creates one "when something is non-empty" — editing qty up from nothing
 * must be able to create it.
 */
export async function updateSiteItemQty(
  siteId: string,
  itemId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const guard = await guardSiteWrite(siteId, canEditSiteItemTracking(user));
  if (!guard.ok) return { error: guard.error };

  const parsed = z.object({ qty: z.coerce.number().min(0, "Qty can't be negative.") }).safeParse({
    qty: formData.get("qty"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { qty } = parsed.data;

  const existing = await db.siteItem.findUnique({ where: { siteId_itemId: { siteId, itemId } } });

  await db.$transaction(async (tx) => {
    const updated = await tx.siteItem.upsert({
      where: { siteId_itemId: { siteId, itemId } },
      update: { qty },
      create: { siteId, itemId, qty },
    });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "SiteItem",
      entityId: updated.id,
      action: existing ? "UPDATE" : "CREATE",
      oldValue: existing ? { qty: decToNumber(existing.qty) } : null,
      newValue: { qty },
      reference: `Qty edited on "${guard.site.name}"`,
    });
  });

  revalidateBoqPages();
  return { success: true };
}

/** plan.md section 4.3 "inline remark/size edit" + section 5 row 2. See updateSiteItemQty for why this is a separate action. */
export async function updateSiteItemRemark(
  siteId: string,
  itemId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const guard = await guardSiteWrite(siteId, canEditSiteItemTracking(user));
  if (!guard.ok) return { error: guard.error };

  const parsed = z.object({ remarkSize: nullableTextSchema }).safeParse({
    remarkSize: formData.get("remarkSize"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { remarkSize } = parsed.data;

  const existing = await db.siteItem.findUnique({ where: { siteId_itemId: { siteId, itemId } } });

  await db.$transaction(async (tx) => {
    const updated = await tx.siteItem.upsert({
      where: { siteId_itemId: { siteId, itemId } },
      update: { remarkSize },
      create: { siteId, itemId, remarkSize },
    });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "SiteItem",
      entityId: updated.id,
      action: existing ? "UPDATE" : "CREATE",
      oldValue: existing ? { remarkSize: existing.remarkSize } : null,
      newValue: { remarkSize },
      reference: `Remark/size edited on "${guard.site.name}"`,
    });
  });

  revalidateBoqPages();
  return { success: true };
}

const TrackingSchema = z.object({
  poAmount: nullableNumberSchema,
  boqLink: nullableTextSchema,
  poLink: nullableTextSchema,
  approvedVia: nullableTextSchema,
  link: nullableTextSchema,
  advanceGiven: nullableNumberSchema,
  stage: nullableTextSchema,
  followUp: nullableTextSchema,
  remarks: nullableTextSchema,
});

/** plan.md section 4.3 "tracking-fields drawer" + section 5 row 2 (order-tracking fields). */
export async function updateSiteItemTracking(
  siteId: string,
  itemId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const guard = await guardSiteWrite(siteId, canEditSiteItemTracking(user));
  if (!guard.ok) return { error: guard.error };

  const parsed = TrackingSchema.safeParse({
    poAmount: formData.get("poAmount"),
    boqLink: formData.get("boqLink"),
    poLink: formData.get("poLink"),
    approvedVia: formData.get("approvedVia"),
    link: formData.get("link"),
    advanceGiven: formData.get("advanceGiven"),
    stage: formData.get("stage"),
    followUp: formData.get("followUp"),
    remarks: formData.get("remarks"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const existing = await db.siteItem.findUnique({ where: { siteId_itemId: { siteId, itemId } } });

  await db.$transaction(async (tx) => {
    const updated = await tx.siteItem.upsert({
      where: { siteId_itemId: { siteId, itemId } },
      update: data,
      create: { siteId, itemId, ...data },
    });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "SiteItem",
      entityId: updated.id,
      action: existing ? "UPDATE" : "CREATE",
      oldValue: existing
        ? {
            poAmount: decToNumber(existing.poAmount),
            boqLink: existing.boqLink,
            poLink: existing.poLink,
            approvedVia: existing.approvedVia,
            link: existing.link,
            advanceGiven: decToNumber(existing.advanceGiven),
            stage: existing.stage,
            followUp: existing.followUp,
            remarks: existing.remarks,
          }
        : null,
      newValue: data,
      reference: `Tracking fields edited on "${guard.site.name}"`,
    });
  });

  revalidateBoqPages();
  return { success: true };
}

/** "" / 0 / negative / unparseable -> null, matching plan.md's "0 or empty both mean missing" rate rule. */
function parseRateField(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const str = String(value).trim();
  if (!str) return null;
  const n = Number(str);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * plan.md section 3's deferred "support a site-specific override later",
 * built now per this session's instruction: Admin only (unlike qty/remark/
 * tracking, which every internal role can edit), still gated by mode and the
 * Site lock — same guardSiteWrite every other SiteItem field goes through.
 */
export async function updateSiteItemRateOverride(
  siteId: string,
  itemId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const guard = await guardSiteWrite(siteId, canEditRateOverride(user));
  if (!guard.ok) return { error: guard.error };

  const rateOverride = parseRateField(formData.get("rateOverride"));

  const existing = await db.siteItem.findUnique({ where: { siteId_itemId: { siteId, itemId } } });

  await db.$transaction(async (tx) => {
    const updated = await tx.siteItem.upsert({
      where: { siteId_itemId: { siteId, itemId } },
      update: { rateOverride },
      create: { siteId, itemId, rateOverride },
    });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "SiteItem",
      entityId: updated.id,
      action: existing ? "UPDATE" : "CREATE",
      oldValue: existing ? { rateOverride: decToNumber(existing.rateOverride) } : null,
      newValue: { rateOverride },
      reference: `Rate override edited on "${guard.site.name}"`,
    });
  });

  revalidateBoqPages();
  return { success: true };
}

const ItemCoreSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  sizeNote: nullableTextSchema,
  note: nullableTextSchema,
  finalVendorId: nullableTextSchema,
});

async function resolveRates(categoryId: string, formData: FormData) {
  const categoryVendors = await db.categoryVendor.findMany({
    where: { categoryId },
    include: { vendor: { select: { id: true, name: true } } },
  });
  const rates = new Map<string, number | null>();
  for (const cv of categoryVendors) {
    rates.set(cv.vendorId, parseRateField(formData.get(`rate_${cv.vendorId}`)));
  }
  return { categoryVendors, rates };
}

function validateFinalVendor(
  finalVendorId: string | null,
  categoryVendors: { vendorId: string }[],
  rates: Map<string, number | null>
): string | null {
  if (!finalVendorId) return null;
  if (!categoryVendors.some((cv) => cv.vendorId === finalVendorId)) {
    return "Final vendor must be one of this category's vendors.";
  }
  if (!rates.get(finalVendorId)) {
    return "Set a rate for the final vendor before choosing it as final.";
  }
  return null;
}

/** plan.md section 4.3 "Admin can add an item (name, vendor rates, final vendor)" — photo upload is milestone M4. */
export async function createItem(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditItems(user)) return { error: "You don't have permission to do this." };

  const modeCheck = await checkModeAllowsWrite("item");
  if (!modeCheck.ok) return { error: modeCheck.error };

  const categoryId = String(formData.get("categoryId") ?? "");
  const category = await db.category.findUnique({ where: { id: categoryId } });
  if (!category) return { error: "Category not found." };

  const parsed = ItemCoreSchema.safeParse({
    name: formData.get("name"),
    sizeNote: formData.get("sizeNote"),
    note: formData.get("note"),
    finalVendorId: formData.get("finalVendorId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const { categoryVendors, rates } = await resolveRates(categoryId, formData);
  const finalVendorError = validateFinalVendor(data.finalVendorId, categoryVendors, rates);
  if (finalVendorError) return { error: finalVendorError };

  const sourceKey = `WEB-${randomUUID()}`;

  await db.$transaction(async (tx) => {
    const created = await tx.item.create({
      data: {
        sourceKey,
        categoryId,
        name: data.name,
        sizeNote: data.sizeNote,
        note: data.note,
        finalVendorId: data.finalVendorId,
      },
    });

    for (const [vendorId, rate] of rates) {
      await tx.vendorRate.create({ data: { itemId: created.id, vendorId, rate } });
    }

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "Item",
      entityId: created.id,
      action: "CREATE",
      newValue: { ...data, categoryId, rates: Object.fromEntries(rates) },
      reference: "Created via Site BOQ item management",
    });
  });

  revalidateBoqPages();
  return { success: true };
}

export async function updateItem(itemId: string, _prevState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditItems(user)) return { error: "You don't have permission to do this." };

  const modeCheck = await checkModeAllowsWrite("item");
  if (!modeCheck.ok) return { error: modeCheck.error };

  const existing = await db.item.findUnique({ where: { id: itemId }, include: { vendorRates: true } });
  if (!existing) return { error: "Item not found." };

  const parsed = ItemCoreSchema.safeParse({
    name: formData.get("name"),
    sizeNote: formData.get("sizeNote"),
    note: formData.get("note"),
    finalVendorId: formData.get("finalVendorId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const { categoryVendors, rates } = await resolveRates(existing.categoryId, formData);
  const finalVendorError = validateFinalVendor(data.finalVendorId, categoryVendors, rates);
  if (finalVendorError) return { error: finalVendorError };

  const oldRates = Object.fromEntries(existing.vendorRates.map((vr) => [vr.vendorId, decToNumber(vr.rate)]));

  await db.$transaction(async (tx) => {
    const updated = await tx.item.update({
      where: { id: itemId },
      data: { name: data.name, sizeNote: data.sizeNote, note: data.note, finalVendorId: data.finalVendorId },
    });

    for (const [vendorId, rate] of rates) {
      await tx.vendorRate.upsert({
        where: { itemId_vendorId: { itemId, vendorId } },
        update: { rate },
        create: { itemId, vendorId, rate },
      });
    }

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "Item",
      entityId: updated.id,
      action: "UPDATE",
      oldValue: {
        name: existing.name,
        sizeNote: existing.sizeNote,
        note: existing.note,
        finalVendorId: existing.finalVendorId,
        rates: oldRates,
      },
      newValue: { ...data, rates: Object.fromEntries(rates) },
      reference: "Updated via Site BOQ item management",
    });
  });

  revalidateBoqPages();
  return { success: true };
}
