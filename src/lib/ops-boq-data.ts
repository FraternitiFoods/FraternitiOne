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
