import "server-only";

import type { OpsBoqRow } from "@prisma/client";
import { db } from "@/lib/db";

/** Serializable (client-safe) shape of a row: decimals as numbers, the date as "yyyy-mm-dd". */
export type OpsBoqRowView = {
  id: string;
  sno: string;
  name: string;
  isFixed: boolean;
  vendor: string | null;
  boqStatus: "NOT_SHARED" | "SHARED";
  amount: number | null;
  linkBoq: string | null;
  linkApprovedBoq: string | null;
  linkPo: string | null;
  approvedVia: string | null;
  link: string | null;
  advanceGiven: number | null;
  stage: string | null;
  followUpDate: string | null;
  remarks: string | null;
};

export function toOpsBoqRowView(row: OpsBoqRow): OpsBoqRowView {
  return {
    id: row.id,
    sno: row.sno,
    name: row.name,
    isFixed: row.isFixed,
    vendor: row.vendor,
    boqStatus: row.boqStatus,
    amount: row.amount === null ? null : row.amount.toNumber(),
    linkBoq: row.linkBoq,
    linkApprovedBoq: row.linkApprovedBoq,
    linkPo: row.linkPo,
    approvedVia: row.approvedVia,
    link: row.link,
    advanceGiven: row.advanceGiven === null ? null : row.advanceGiven.toNumber(),
    stage: row.stage,
    followUpDate: row.followUpDate ? row.followUpDate.toISOString().slice(0, 10) : null,
    remarks: row.remarks,
  };
}

export async function getOpsBoqRows(siteId: string): Promise<OpsBoqRowView[]> {
  const rows = await db.opsBoqRow.findMany({
    where: { siteId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toOpsBoqRowView);
}

/**
 * Sites for the Operations BOQ "Select Site" dropdown. Not just `usedInBoq`
 * sites (what getActiveSites() returns): the unified sync's Site BOQ leg turns
 * `usedInBoq` off for any site missing from the Rate Sheet, so a site that only
 * exists in the Ops sheet (or whose ops rows were synced) would otherwise never
 * appear here. Any active site that has Operations BOQ rows is listed too.
 */
export async function getOpsBoqSites() {
  return db.site.findMany({
    where: { isActive: true, OR: [{ usedInBoq: true }, { opsBoqRows: { some: {} } }] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

/**
 * When the unified sync last committed the Ops BOQ leg (ISO string, "" if never).
 * OpsBoqTable keeps its rows in client state, so after a sync (router.refresh()
 * delivers fresh `rows` props) it is re-keyed by this value to remount with them.
 */
export async function getOpsBoqSyncToken(): Promise<string> {
  const leg = await db.syncLeg.findFirst({
    where: { leg: "OPS_BOQ", status: "COMMITTED" },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  return leg?.finishedAt ? leg.finishedAt.toISOString() : "";
}
