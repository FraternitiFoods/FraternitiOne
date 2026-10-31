"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canCreatePo } from "@/lib/permissions";
import { checkModeAllowsWrite } from "@/lib/site-boq-write-guard";
import { getAppSettings } from "@/lib/app-settings";
import { getComputedItems } from "@/lib/boq-data";
import { buildPoPreviews, resolveSelectedVendorIds } from "@/lib/po-calc";
import { nextPoRunningNumber, formatPoNumber } from "@/lib/po-number";

export type ActionState = { error?: string } | undefined;

const CreatePoSchema = z.object({
  siteId: z.string().min(1, "Site is required."),
  categoryId: z.string().min(1, "Category is required."),
  poDate: z.string().min(1, "PO date is required."),
  deliveryDays: z.coerce.number().int().min(0, "Delivery days can't be negative."),
  gstPercent: z.coerce.number().min(0, "GST % can't be negative.").max(100, "GST % can't exceed 100."),
  paymentTerms: z.string().trim().min(1, "Payment terms are required."),
});

/**
 * plan.md section 4.5 — "Create: choose site, category, one or more vendors
 * (or all vendors), PO date, delivery-by/days, GST %, payment terms. Lines =
 * items for that site+category (qty > 0) whose final vendor is the chosen
 * vendor." A single submit can create several POs at once (one per vendor
 * that actually has qty > 0 lines) since PurchaseOrder.vendorId is one
 * vendor per PO — "vendor(s) or all vendors" means "run this once per
 * vendor," not one PO spanning several vendors.
 *
 * Recomputes everything from `getComputedItems()` server-side rather than
 * trusting any amounts the preview page rendered — the only things taken
 * from the form are the *selection* (site/category/vendor ids, dates,
 * GST%, terms), never a line's rate or amount.
 */
export async function createPurchaseOrders(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canCreatePo(user)) return { error: "You don't have permission to do this." };

  // "purchaseOrder" is mode-exempt (plan.md section 4.5: "Allowed in both
  // modes") — called anyway for the same reason updateVendor/updateAppSettings
  // call it despite being exempt: one place enforces the rule, so it can't
  // silently drift if the exemption list ever changes.
  const modeCheck = await checkModeAllowsWrite("purchaseOrder");
  if (!modeCheck.ok) return { error: modeCheck.error };

  const parsed = CreatePoSchema.safeParse({
    siteId: formData.get("siteId"),
    categoryId: formData.get("categoryId"),
    poDate: formData.get("poDate"),
    deliveryDays: formData.get("deliveryDays"),
    gstPercent: formData.get("gstPercent"),
    paymentTerms: formData.get("paymentTerms"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const poDate = new Date(`${data.poDate}T00:00:00`);
  if (Number.isNaN(poDate.getTime())) return { error: "Enter a valid PO date." };

  const [site, category, settings] = await Promise.all([
    db.site.findUnique({ where: { id: data.siteId } }),
    db.category.findUnique({ where: { id: data.categoryId } }),
    getAppSettings(),
  ]);
  if (!site) return { error: "Site not found." };
  if (!category) return { error: "Category not found." };

  const categoryVendorRows = await db.categoryVendor.findMany({
    where: { categoryId: data.categoryId },
    include: { vendor: true },
  });
  const selectedVendorIds = resolveSelectedVendorIds(
    formData.getAll("vendor").map(String),
    categoryVendorRows.map((cv) => cv.vendorId)
  );
  if (selectedVendorIds.length === 0) return { error: "Select at least one vendor, or All vendors." };

  const vendorsById = new Map(categoryVendorRows.map((cv) => [cv.vendorId, cv.vendor]));
  const selectedVendors = selectedVendorIds
    .map((id) => vendorsById.get(id))
    .filter((v): v is NonNullable<typeof v> => Boolean(v));

  const items = (await getComputedItems()).filter((item) => item.categoryId === data.categoryId);
  const previews = buildPoPreviews({ items, siteId: data.siteId, vendors: selectedVendors, gstPercent: data.gstPercent });
  if (previews.length === 0) {
    return { error: "No items with qty > 0 found for the selected vendor(s) in this site and category." };
  }

  const deliveryBy = new Date(poDate);
  deliveryBy.setDate(deliveryBy.getDate() + data.deliveryDays);

  const companySnapshot = {
    name: settings.companyName,
    address: settings.companyAddress,
    gstin: settings.companyGstin,
    phone: settings.companyPhone,
    email: settings.companyEmail,
    signatoryName: settings.signatoryName,
  };
  const termsSnapshot = { poTerms: settings.poTerms, deliveryDays: data.deliveryDays, paymentTerms: data.paymentTerms };

  // One photo (sortOrder 0, plan.md section 3) per candidate item, fetched
  // once and shared across whichever vendor's lines include that item.
  const itemIds = [...new Set(previews.flatMap((p) => p.lines.map((line) => line.itemId)))];
  const photos = itemIds.length
    ? await db.itemPhoto.findMany({ where: { itemId: { in: itemIds }, sortOrder: 0 }, select: { itemId: true, storageKey: true } })
    : [];
  const photoByItemId = new Map(photos.map((p) => [p.itemId, p.storageKey]));

  const createdIds: string[] = [];
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // A fresh running-number base is recomputed on every attempt — if a
    // concurrent create claimed the number in between, retrying here picks
    // up the number it actually used instead of colliding again.
    const startingNumber = await nextPoRunningNumber(settings.poNumberPrefix, poDate.getFullYear());
    try {
      await db.$transaction(async (tx) => {
        createdIds.length = 0;
        for (const [index, preview] of previews.entries()) {
          const vendor = vendorsById.get(preview.vendorId)!;
          const poNumber = formatPoNumber(settings.poNumberPrefix, poDate.getFullYear(), startingNumber + index);
          const created = await tx.purchaseOrder.create({
            data: {
              poNumber,
              siteId: data.siteId,
              categoryId: data.categoryId,
              vendorId: preview.vendorId,
              poDate,
              deliveryBy,
              deliveryDays: data.deliveryDays,
              paymentTerms: data.paymentTerms,
              gstPercent: data.gstPercent,
              subtotal: preview.totals.subtotal,
              gstAmount: preview.totals.gstAmount,
              total: preview.totals.total,
              status: "ISSUED",
              createdById: user.id,
              companySnapshot,
              vendorSnapshot: {
                name: vendor.name,
                address: vendor.address,
                gstin: vendor.gstin,
                phone: vendor.phone,
                email: vendor.email,
              },
              siteSnapshot: { name: site.name, shortCode: site.shortCode, note: site.note },
              termsSnapshot,
              lines: {
                create: preview.lines.map((line) => ({
                  itemId: line.itemId,
                  nameSnapshot: line.name,
                  remarkSize: line.remarkSize,
                  qty: line.qty,
                  rate: line.rate ?? 0,
                  amount: line.amount,
                  photoStorageKey: photoByItemId.get(line.itemId) ?? null,
                })),
              },
            },
          });
          createdIds.push(created.id);

          await writeAuditEvent(tx, {
            actor: user,
            entityType: "PurchaseOrder",
            entityId: created.id,
            action: "CREATE",
            newValue: { poNumber, siteId: data.siteId, vendorId: preview.vendorId, total: preview.totals.total },
            reference: `Created for "${site.name}" / ${category.displayName} / ${vendor.name}`,
          });
        }
      });
      break;
    } catch (err) {
      const isUniqueViolation = typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
      if (!isUniqueViolation || attempt === MAX_ATTEMPTS - 1) throw err;
    }
  }

  redirect(`/site-boq/purchase-orders?created=${createdIds.join(",")}`);
}
