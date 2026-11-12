import { requireOpsBoqUser } from "@/lib/ops-boq-access";
import { canEditOpsBoq } from "@/lib/permissions";
import { getActiveSites } from "@/lib/boq-data";
import { getOpsBoqRows } from "@/lib/ops-boq-data";
import { todayIsoIST } from "@/lib/ops-boq-calc";
import { PageHeader } from "@/components/page-header";
import { OpsBoqApp } from "./_components/ops-boq-app";

/**
 * Operations BOQ (operations-boq-handoff.md): pick a site, edit its one
 * procurement table. Viewing is internal-only (403 for a franchisee, in
 * requireOpsBoqUser); editing is Admin + OPERATIONS and is re-checked in every
 * Server Action — `canEdit` here only drives the disabled inputs.
 */
export default async function OperationsBoqPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOpsBoqUser();

  const siteParam = (await props.searchParams).site;
  const requestedSiteId = typeof siteParam === "string" ? siteParam : null;

  const sites = await getActiveSites();
  const selected = requestedSiteId ? sites.find((s) => s.id === requestedSiteId) : undefined;
  const rows = selected ? await getOpsBoqRows(selected.id) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Operations BOQ" subtitle="Procurement status, vendors and payments for each site." isFranchisee={false} />
      <OpsBoqApp
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        selectedSiteId={selected?.id ?? null}
        rows={rows}
        canEdit={canEditOpsBoq(user)}
        todayIso={todayIsoIST()}
      />
    </div>
  );
}
