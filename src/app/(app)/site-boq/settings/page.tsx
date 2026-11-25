import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { getAppSettings } from "@/lib/app-settings";
import { getRecentBoqAuditEvents } from "@/lib/boq-data";
import { canEditSettings, canFlipMode, canViewAuditLog } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SiteBoqSubNav } from "../_components/sub-nav";
import { ModeSwitch } from "./_components/mode-switch";
import { SettingsForm } from "./_components/settings-form";
import { AuditLogTable } from "./_components/audit-log-table";

/** plan.md section 4.7 — Settings. Mode switch, the editable settings form and the audit log viewer are Admin only. */
export default async function SiteBoqSettingsPage() {
  const user = await requireSiteBoqUser();

  const settings = await getAppSettings();

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
              ? "Site BOQ editing is disabled for everyone until an Admin switches the mode."
              : "The website is the source of truth — editing is enabled per role."}
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
