import "server-only";

import { db } from "@/lib/db";
import { decToNumber, finalRateOf, rateForAmount, amountOf, isOrdered, pendingAmount } from "@/lib/boq-calc";

export type ComputedSiteEntry = {
  siteId: string;
  qty: number;
  rate: number | null;
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
};

export type ComputedItem = {
  id: string;
  sourceKey: string;
  name: string;
  sizeNote: string | null;
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
        };
      });

    return {
      id: item.id,
      sourceKey: item.sourceKey,
      name: item.name,
      sizeNote: item.sizeNote,
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
