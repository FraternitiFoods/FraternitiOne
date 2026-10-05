"use client";

import { useActionState } from "react";
import { updateLoiDraft, resetLoiSection, newLoiVersionFromCurrent } from "./loi-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LoiVersionStatus, OnboardingEntityType } from "@prisma/client";

type LoiValuesPlain = {
  name: string;
  aadhaarMasked: string;
  feeAmount: string;
  feeInWords: string;
  territory: string;
  issueDate: string;
  versionNo: string;
};

/**
 * plan.md section 19 L3: lets LOI_PREPARER/ADMIN edit a DRAFT's template
 * variables and per-§SECTION wording before release, or (once RELEASED+)
 * start a fresh DRAFT copied from it to keep editing. "FIELDS" is never
 * shown here — see the exclusion note on LOI_SECTION_LABELS in loi-pdf.ts.
 */
export function LoiEditPanel({
  onboardingId,
  entityType,
  canEdit,
  currentVersion,
  sectionDefaults,
  sectionLabels,
}: {
  onboardingId: string;
  entityType: OnboardingEntityType;
  canEdit: boolean;
  currentVersion: {
    id: string;
    status: LoiVersionStatus;
    versionNo: string;
    values: LoiValuesPlain;
    bodyOverrides: Record<string, string>;
  } | null;
  sectionDefaults: Record<string, string>;
  sectionLabels: { key: string; label: string }[];
}) {
  const [updateState, updateAction, updatePending] = useActionState(
    updateLoiDraft.bind(null, onboardingId),
    undefined
  );
  const [resetState, resetAction, resetPending] = useActionState(
    resetLoiSection.bind(null, onboardingId),
    undefined
  );
  const [newVersionState, newVersionAction, newVersionPending] = useActionState(
    newLoiVersionFromCurrent.bind(null, onboardingId),
    undefined
  );

  if (!canEdit || !currentVersion) return null;

  if (currentVersion.status !== "DRAFT") {
    return (
      <form action={newVersionAction} className="space-y-2 rounded-md border p-4">
        <p className="text-sm font-medium">Edit wording or values</p>
        <p className="text-xs text-muted-foreground">
          v{currentVersion.versionNo} is {currentVersion.status.toLowerCase()} and can&apos;t be changed in
          place (P1-11). Start a new draft copied from it to keep editing.
        </p>
        {newVersionState?.error && (
          <p className="text-sm text-destructive" role="alert">
            {newVersionState.error}
          </p>
        )}
        <Button type="submit" variant="outline" disabled={newVersionPending}>
          {newVersionPending ? "Creating…" : "New version from this"}
        </Button>
      </form>
    );
  }

  const { values, bodyOverrides } = currentVersion;

  function resetSection(key: string) {
    const fd = new FormData();
    fd.set("sectionKey", key);
    resetAction(fd);
  }

  return (
    <form action={updateAction} className="space-y-4 rounded-md border p-4">
      <p className="text-sm font-medium">Edit draft v{currentVersion.versionNo}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="edit-territory">Territory</Label>
          <Input id="edit-territory" name="territory" defaultValue={values.territory} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-feeAmountRupees">Fee amount (₹)</Label>
          <Input
            id="edit-feeAmountRupees"
            name="feeAmountRupees"
            type="number"
            min="1"
            defaultValue={values.feeAmount.replace(/,/g, "")}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-issueDate">Issue date</Label>
          <Input id="edit-issueDate" name="issueDate" defaultValue={values.issueDate} />
        </div>
        {entityType === "COMPANY" && (
          <div className="space-y-1">
            <Label htmlFor="edit-companyName">Company name</Label>
            <Input id="edit-companyName" name="companyName" defaultValue={values.name} />
          </div>
        )}
      </div>

      <div className="space-y-3">
        {sectionLabels.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor={`override_${key}`}>{label}</Label>
              {key in bodyOverrides && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={resetPending}
                  onClick={() => resetSection(key)}
                >
                  Reset to template
                </Button>
              )}
            </div>
            <Textarea
              // Uncontrolled (defaultValue) — re-keyed on override
              // presence so "Reset to template" (which changes this on the
              // server, not in this input's own DOM node) actually forces
              // React to remount it with the template's text instead of
              // leaving the old content on screen.
              key={`${key}-${key in bodyOverrides ? "override" : "default"}`}
              id={`override_${key}`}
              name={`override_${key}`}
              defaultValue={bodyOverrides[key] ?? sectionDefaults[key] ?? ""}
              rows={4}
            />
          </div>
        ))}
      </div>

      {updateState?.error && (
        <p className="text-sm text-destructive" role="alert">
          {updateState.error}
        </p>
      )}
      {resetState?.error && (
        <p className="text-sm text-destructive" role="alert">
          {resetState.error}
        </p>
      )}
      <Button type="submit" disabled={updatePending}>
        {updatePending ? "Saving…" : "Save draft"}
      </Button>
    </form>
  );
}
