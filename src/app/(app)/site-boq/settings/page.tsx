import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { getAppSettings } from "@/lib/app-settings";
import { getLatestImportRun, getRecentBoqAuditEvents } from "@/lib/boq-data";
import { canEditSettings, canFlipMode, canViewAuditLog } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { SiteBoqSubNav } from "../_components/sub-nav";
import { ModeSwitch } from "./_components/mode-switch";
import { SettingsForm } from "./_components/settings-form";
import { AuditLogTable } from "./_components/audit-log-table";

type ImportCounts = Partial<{
  sites: number;
  vendors: number;
  categories: number;
  items: number;
  vendorRates: number;
  siteItems: number;
  photos: number;
}>;

/** plan.md section 4.7 — Settings. Mode switch, the editable settings form and the audit log viewer are Admin only. */
export default async function SiteBoqSettingsPage() {
  const user = await requireSiteBoqUser();

  const [settings, importRun] = await Promise.all([getAppSettings(), getLatestImportRun()]);
  const counts = (importRun?.counts ?? {}) as ImportCounts;
  const warnings = Array.isArray(importRun?.warnings) ? (importRun.warnings as string[]) : [];

  const canSwitchMode = canFlipMode(user);
  const canEditTheSettings = canEditSettings(user);
  const canSeeAuditLog = canViewAuditLog(user);
  const auditEvents = canSeeAuditLog ? await getRecentBoqAuditEvents() : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
      <SiteBoqSubNav active="settings" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge variant={settings.mode === "SHEET_LIVE" ? "secondary" : "outline"}>{settings.mode}</Badge>
          <p className="text-xs text-muted-foreground">
            {settings.mode === "SHEET_LIVE"
              ? "The sheet is the source of truth — the website is read-only and the import push is enabled."
              : "The website is the source of truth — editing is enabled per role and the import push returns 403."}
          </p>
          {canSwitchMode ? (
            <div className="pt-1">
              <ModeSwitch key={settings.mode} currentMode={settings.mode} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Switching modes is Admin-only.</p>
          )}
        </CardContent>
      </Card>

      {canEditTheSettings ? (
        <SettingsForm settings={settings} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company details (PO header)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <SettingRow label="Company name" value={settings.companyName} />
              <SettingRow label="Address" value={settings.companyAddress} />
              <SettingRow label="GSTIN" value={settings.companyGstin} />
              <SettingRow label="Phone" value={settings.companyPhone} />
              <SettingRow label="Email" value={settings.companyEmail} />
              <SettingRow label="Signatory" value={settings.signatoryName} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">PO defaults</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <SettingRow label="Default GST %" value={`${settings.defaultGstPercent}%`} />
              <SettingRow label="Default payment terms" value={settings.defaultPaymentTerms} />
              <SettingRow label="Default delivery days" value={String(settings.defaultDeliveryDays)} />
              <SettingRow label="PO number prefix" value={settings.poNumberPrefix} />
              <div className="pt-2">
                <p className="text-xs font-medium text-muted-foreground">PO terms</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
                  {settings.poTerms.map((term, i) => (
                    <li key={i}>{term}</li>
                  ))}
                </ol>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Urgency thresholds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <SettingRow label="Urgent within" value={`${settings.urgentDays} days`} />
              <SettingRow label="This month within" value={`${settings.soonDays} days`} />
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!importRun ? (
            <p className="text-muted-foreground">No import has run yet.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={importRun.status === "COMMITTED" ? "outline" : importRun.status === "FAILED" ? "destructive" : "secondary"}>
                  {importRun.status}
                </Badge>
                <span className="text-muted-foreground">Started {formatDateTime(importRun.startedAt)}</span>
                {importRun.finishedAt && (
                  <span className="text-muted-foreground">Finished {formatDateTime(importRun.finishedAt)}</span>
                )}
                {importRun.dryRun && <Badge variant="secondary">Dry run</Badge>}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <CountCard label="Sites" value={counts.sites} />
                <CountCard label="Vendors" value={counts.vendors} />
                <CountCard label="Categories" value={counts.categories} />
                <CountCard label="Items" value={counts.items} />
                <CountCard label="Vendor rates" value={counts.vendorRates} />
                <CountCard label="Site items" value={counts.siteItems} />
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">Warnings ({warnings.length})</p>
                {warnings.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">None.</p>
                ) : (
                  <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto rounded-lg bg-muted p-2 text-xs text-muted-foreground">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {canSeeAuditLog && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Recent edits (audit log)</h2>
          <AuditLogTable events={auditEvents} />
        </section>
      )}
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || "—"}</span>
    </div>
  );
}

function CountCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold">{value ?? 0}</p>
    </div>
  );
}
