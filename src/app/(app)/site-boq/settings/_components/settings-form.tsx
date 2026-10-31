"use client";

import { useActionState } from "react";
import { updateAppSettings, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { AppSettingsValues } from "@/lib/app-settings";

/** plan.md section 4.7 — company details, PO defaults/terms, urgency thresholds. Admin only (gated by the caller). */
export function SettingsForm({ settings }: { settings: AppSettingsValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateAppSettings, undefined);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Company details (PO header)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Company name" name="companyName" defaultValue={settings.companyName} />
            <Field label="Address" name="companyAddress" defaultValue={settings.companyAddress} />
            <Field label="GSTIN" name="companyGstin" defaultValue={settings.companyGstin} />
            <Field label="Phone" name="companyPhone" defaultValue={settings.companyPhone} />
            <Field label="Email" name="companyEmail" type="email" defaultValue={settings.companyEmail} />
            <Field label="Signatory" name="signatoryName" defaultValue={settings.signatoryName} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">PO defaults</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Default GST %" name="defaultGstPercent" type="number" defaultValue={String(settings.defaultGstPercent)} />
            <Field label="Default payment terms" name="defaultPaymentTerms" defaultValue={settings.defaultPaymentTerms} />
            <Field
              label="Default delivery days"
              name="defaultDeliveryDays"
              type="number"
              defaultValue={String(settings.defaultDeliveryDays)}
            />
            <div className="space-y-1.5">
              <Label>PO terms</Label>
              {settings.poTerms.map((term, i) => (
                <Input key={i} name={`poTerm${i}`} defaultValue={term} placeholder={`Term ${i + 1}`} className="mb-1.5" />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Urgency thresholds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Urgent within (days)" name="urgentDays" type="number" defaultValue={String(settings.urgentDays)} />
            <Field label="This month within (days)" name="soonDays" type="number" defaultValue={String(settings.soonDays)} />
          </CardContent>
        </Card>
      </div>

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} />
    </div>
  );
}
