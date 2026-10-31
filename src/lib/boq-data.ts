import "server-only";

import { db } from "@/lib/db";
import { decToNumber, finalRateOf, rateForAmount, amountOf, isOrdered, pendingAmount } from "@/lib/boq-calc";

export type ComputedSiteEntry = {
  siteId: string;
  qty: number;
  rate: number | null;
  /** The raw per-site override, independent of whether it's actually in effect (locked sites ignore it) — lets the UI show an "Overridden" marker and prefill the edit field. */
  rateOverride: number | null;
  amount: number;
  hasRate: boolean;
  ordered: boolean;
  stage: string | null;
  remarkSize: string | null;
  poAmount: number | null;
  advanceGiven: number | null;
  pending: number | null;
  boqLink: string | null;
  poLink: string | null;
  approvedVia: string | null;
  link: string | null;
  followUp: string | null;
  remarks: string | null;
};

export type ComputedItem = {
  id: string;
  sourceKey: string;
  name: string;
  sizeNote: string | null;
  note: string | null;
  categoryId: string;
  finalVendorId: string | null;
  finalVendorName: string | null;
  finalRate: number | null;
  vendorRates: { vendorId: string; vendorName: string; rate: number | null }[];
  /** One entry per site that has a SiteItem row for this item (plan.md section 3: "create rows only when something is non-empty"). */
  siteEntries: ComputedSiteEntry[];
};

/**
 * The single source of computed BOQ numbers (plan.md section 3 "Rate rules",
 * section 6.2 "Order status") — every read-only screen (Overview, Site view,
 * Items & Qty) derives its totals from this same array so a rate/amount rule
 * can't drift between pages.
 */
export async function getComputedItems(): Promise<ComputedItem[]> {
  const items = await db.item.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      finalVendor: { select: { id: true, name: true } },
      vendorRates: { include: { vendor: { select: { id: true, name: true } } } },
      siteItems: { include: { site: { select: { id: true, isActive: true, isLocked: true } } } },
    },
  });

  return items.map((item) => {
    const vendorRates = item.vendorRates.map((vr) => ({
      vendorId: vr.vendorId,
      vendorName: vr.vendor.name,
      rate: decToNumber(vr.rate),
    }));
    const finalRate = finalRateOf(item.finalVendorId, vendorRates);

    const siteEntries: ComputedSiteEntry[] = item.siteItems
      .filter((si) => si.site.isActive)
      .map((si) => {
        const qty = decToNumber(si.qty) ?? 0;
        const rate = rateForAmount({
          isLocked: si.site.isLocked,
          lockedRate: si.lockedRate,
          rateOverride: si.rateOverride,
          finalRate,
        });
        const poAmount = decToNumber(si.poAmount);
        const advanceGiven = decToNumber(si.advanceGiven);
        return {
          siteId: si.siteId,
          qty,
          rate,
          rateOverride: decToNumber(si.rateOverride),
          amount: amountOf(qty, rate),
          hasRate: rate !== null,
          ordered: isOrdered(si),
          stage: si.stage,
          remarkSize: si.remarkSize,
          poAmount,
          advanceGiven,
          pending: pendingAmount(poAmount, advanceGiven),
          boqLink: si.boqLink,
          poLink: si.poLink,
          approvedVia: si.approvedVia,
          link: si.link,
          followUp: si.followUp,
          remarks: si.remarks,
        };
      });

    return {
      id: item.id,
      sourceKey: item.sourceKey,
      name: item.name,
      sizeNote: item.sizeNote,
      note: item.note,
      categoryId: item.categoryId,
      finalVendorId: item.finalVendorId,
      finalVendorName: item.finalVendor?.name ?? null,
      finalRate,
      vendorRates,
      siteEntries,
    };
  });
}

export async function getActiveSites() {
  return db.site.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getAllSites() {
  return db.site.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/** Categories are a closed, rarely-changing list (plan.md section 1) — no is_active to filter on. */
export async function getActiveCategories() {
  return db.category.findMany({ orderBy: [{ sortOrder: "asc" }] });
}

export async function getVendorsGroupedByCategory() {
  return db.vendor.findMany({
    orderBy: { name: "asc" },
    include: { categoryVendors: { include: { category: true } } },
  });
}

export async function getLatestImportRun() {
  return db.importRun.findFirst({ orderBy: { startedAt: "desc" } });
}

const BOQ_AUDIT_ENTITY_TYPES = ["SiteItem", "Item", "Vendor", "Site", "AppSetting"] as const;

/**
 * plan.md section 5 "a lightweight audit log for edits in WEBSITE_LIVE" +
 * the Settings "simple viewer" — filtered to Site BOQ's own entity types so
 * this doesn't mix in unrelated User-management audit events that share the
 * same AuditEvent table.
 */
export async function getRecentBoqAuditEvents(limit = 50) {
  return db.auditEvent.findMany({
    where: { entityType: { in: [...BOQ_AUDIT_ENTITY_TYPES] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** plan.md section 4.5 — PO list, searchable by number, site name or vendor name. */
export async function getPurchaseOrders(q?: string) {
  const query = q?.trim();
  return db.purchaseOrder.findMany({
    where: query
      ? {
          OR: [
            { poNumber: { contains: query, mode: "insensitive" } },
            { site: { name: { contains: query, mode: "insensitive" } } },
            { vendor: { name: { contains: query, mode: "insensitive" } } },
          ],
        }
      : undefined,
    include: { site: { select: { name: true } }, vendor: { select: { name: true } }, category: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPurchaseOrderById(id: string) {
  return db.purchaseOrder.findUnique({
    where: { id },
    include: {
      site: { select: { name: true } },
      vendor: { select: { name: true } },
      category: { select: { displayName: true } },
      createdBy: { select: { name: true, email: true } },
      lines: { orderBy: { id: "asc" } },
    },
  });
}
