"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canEditSites, canLockSite } from "@/lib/permissions";
import { checkModeAllowsWrite } from "@/lib/site-boq-write-guard";
import { decToNumber, finalRateOf, rateForAmount } from "@/lib/boq-calc";

export type ActionState = { error?: string; success?: boolean } | undefined;

const nullableTextSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const SiteSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  shortCode: nullableTextSchema,
  openingDate: nullableTextSchema,
  note: nullableTextSchema,
});

function revalidateBoqPages() {
  revalidatePath("/site-boq");
  revalidatePath("/site-boq/site-view");
  revalidatePath("/site-boq/sites");
  revalidatePath("/site-boq/items");
}

/** <input type="date"> gives "yyyy-mm-dd" or "" — "invalid" means a value was given but couldn't be parsed. */
function parseOpeningDate(value: string | null): Date | null | "invalid" {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/**
 * plan.md section 4.6 — Sites (Admin). Gated by mode like every other BOQ
 * write (section 1: "read-only everywhere" in SHEET_LIVE); sites aren't on
 * the small mode-exemption list (vendor contact details, PO creation,
 * settings), so add/rename/hide only work once mode = WEBSITE_LIVE.
 */
export async function createSite(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditSites(user)) return { error: "You don't have permission to do this." };

  const modeCheck = await checkModeAllowsWrite("site");
  if (!modeCheck.ok) return { error: modeCheck.error };

  const parsed = SiteSchema.safeParse({
    name: formData.get("name"),
    shortCode: formData.get("shortCode"),
    openingDate: formData.get("openingDate"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const openingDate = parseOpeningDate(data.openingDate);
  if (openingDate === "invalid") return { error: "Invalid opening date." };

  const nameTaken = await db.site.findUnique({ where: { name: data.name } });
  if (nameTaken) return { error: "A site with this name already exists." };

  const sourceKey = `WEB-${randomUUID()}`;

  await db.$transaction(async (tx) => {
    const created = await tx.site.create({
      data: { sourceKey, name: data.name, shortCode: data.shortCode, openingDate, note: data.note },
    });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "Site",
      entityId: created.id,
      action: "CREATE",
      newValue: { name: data.name, shortCode: data.shortCode, openingDate: data.openingDate, note: data.note },
      reference: "Created via Site BOQ site management",
    });
  });

  revalidateBoqPages();
  return { success: true };
}

export async function updateSite(siteId: string, _prevState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditSites(user)) return { error: "You don't have permission to do this." };

  const modeCheck = await checkModeAllowsWrite("site");
  if (!modeCheck.ok) return { error: modeCheck.error };

  const existing = await db.site.findUnique({ where: { id: siteId } });
  if (!existing) return { error: "Site not found." };

  const parsed = SiteSchema.safeParse({
    name: formData.get("name"),
    shortCode: formData.get("shortCode"),
    openingDate: formData.get("openingDate"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const openingDate = parseOpeningDate(data.openingDate);
  if (openingDate === "invalid") return { error: "Invalid opening date." };

  if (data.name !== existing.name) {
    const nameTaken = await db.site.findFirst({ where: { name: data.name, id: { not: siteId } } });
    if (nameTaken) return { error: "A site with this name already exists." };
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.site.update({
      where: { id: siteId },
      data: { name: data.name, shortCode: data.shortCode, openingDate, note: data.note },
    });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "Site",
      entityId: updated.id,
      action: "UPDATE",
      oldValue: {
        name: existing.name,
        shortCode: existing.shortCode,
        openingDate: existing.openingDate?.toISOString() ?? null,
        note: existing.note,
      },
      newValue: { name: data.name, shortCode: data.shortCode, openingDate: data.openingDate, note: data.note },
      reference: "Updated via Site BOQ site management",
    });
  });

  revalidateBoqPages();
  return { success: true };
}

export async function setSiteActive(
  siteId: string,
  isActive: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: ActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditSites(user)) return { error: "You don't have permission to do this." };

  const modeCheck = await checkModeAllowsWrite("site");
  if (!modeCheck.ok) return { error: modeCheck.error };

  const existing = await db.site.findUnique({ where: { id: siteId } });
  if (!existing) return { error: "Site not found." };

  await db.$transaction(async (tx) => {
    await tx.site.update({ where: { id: siteId }, data: { isActive } });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "Site",
      entityId: siteId,
      action: "UPDATE",
      oldValue: { isActive: existing.isActive },
      newValue: { isActive },
      reference: isActive ? "Shown via Site BOQ site management" : "Hidden via Site BOQ site management",
    });
  });

  revalidateBoqPages();
  return { success: true };
}

/**
 * plan.md section 3 "Site lock" + section 5's own row: lock/unlock is
 * Admin-only in BOTH modes — deliberately not gated by checkModeAllowsWrite,
 * since locking isn't a BOQ data edit, it's a website-native switch.
 *
 * Snapshots each SiteItem's current effective rate into lockedRate using the
 * same rateForAmount/finalRateOf functions every screen already reads
 * amounts through (with isLocked:false, i.e. "what the rate is right now,
 * before freezing it") — so later changes to the item's final vendor/rate
 * can never move this site's numbers again until it's unlocked.
 */
export async function lockSite(
  siteId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: ActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!canLockSite(user)) return { error: "You don't have permission to do this." };

  const site = await db.site.findUnique({ where: { id: siteId } });
  if (!site) return { error: "Site not found." };
  if (site.isLocked) return { error: "This site is already locked." };

  const siteItems = await db.siteItem.findMany({
    where: { siteId },
    include: { item: { include: { vendorRates: true } } },
  });

  await db.$transaction(async (tx) => {
    for (const si of siteItems) {
      const vendorRates = si.item.vendorRates.map((vr) => ({ vendorId: vr.vendorId, rate: decToNumber(vr.rate) }));
      const finalRate = finalRateOf(si.item.finalVendorId, vendorRates);
      const effectiveRate = rateForAmount({
        isLocked: false,
        lockedRate: null,
        rateOverride: si.rateOverride,
        finalRate,
      });
      await tx.siteItem.update({ where: { id: si.id }, data: { lockedRate: effectiveRate } });
    }

    await tx.site.update({
      where: { id: siteId },
      data: { isLocked: true, lockedAt: new Date(), lockedById: user.id },
    });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "Site",
      entityId: siteId,
      action: "UPDATE",
      oldValue: { isLocked: false },
      newValue: { isLocked: true },
      reference: `Locked "${site.name}"`,
    });
  });

  revalidateBoqPages();
  return { success: true };
}

/** plan.md section 3 "Unlock requires a confirmation dialog, then clears every locked_rate back to null ... and writes an audit log entry." */
export async function unlockSite(
  siteId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: ActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!canLockSite(user)) return { error: "You don't have permission to do this." };

  const site = await db.site.findUnique({ where: { id: siteId } });
  if (!site) return { error: "Site not found." };
  if (!site.isLocked) return { error: "This site is not locked." };

  await db.$transaction(async (tx) => {
    await tx.siteItem.updateMany({ where: { siteId }, data: { lockedRate: null } });

    await tx.site.update({
      where: { id: siteId },
      data: { isLocked: false, lockedAt: null, lockedById: null },
    });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "Site",
      entityId: siteId,
      action: "UPDATE",
      oldValue: { isLocked: true },
      newValue: { isLocked: false },
      reference: `Unlocked "${site.name}"`,
    });
  });

  revalidateBoqPages();
  return { success: true };
}
