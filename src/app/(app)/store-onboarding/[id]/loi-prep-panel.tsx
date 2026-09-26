"use client";

import { useActionState } from "react";
import Link from "next/link";
import { generateLoiVersion, releaseLoiVersion, updateExpectedAmount } from "./loi-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { LOI_VERSION_STATUS_LABELS, formatMoney } from "@/lib/onboarding/format";
import type { LoiVersionStatus, OnboardingEntityType } from "@prisma/client";

type LoiVersionInfo = {
  id: string;
  versionNo: string;
  status: LoiVersionStatus;
  createdAt: string;
};

export function LoiPrepPanel({
  onboardingId,
  entityType,
  expectedAmount,
  currentVersion,
  allVersions,
  canEdit,
}: {
  onboardingId: string;
  entityType: OnboardingEntityType;
  expectedAmount: number;
  currentVersion: LoiVersionInfo | null;
  allVersions: LoiVersionInfo[];
  canEdit: boolean;
}) {
  const [genState, genAction, genPending] = useActionState(generateLoiVersion.bind(null, onboardingId), undefined);
  const [releaseState, releaseAction, releasePending] = useActionState(
    releaseLoiVersion.bind(null, onboardingId),
    undefined
  );
  const [feeState, feeAction, feePending] = useActionState(updateExpectedAmount.bind(null, onboardingId), undefined);

  return (
    <div className="space-y-4">
      {allVersions.length > 0 && (
        <div className="space-y-1">
          {allVersions.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span>v{v.versionNo}</span>
              <Badge variant="outline">{LOI_VERSION_STATUS_LABELS[v.status]}</Badge>
              <div className="flex gap-3">
                <Link href={`/api/loi-versions/${v.id}/download`} className="text-primary hover:underline" target="_blank">
                  Draft/preview
                </Link>
                {v.status === "SIGNED" && (
                  <>
                    <Link
                      href={`/api/loi-versions/${v.id}/download?file=signed`}
                      className="text-primary hover:underline"
                      target="_blank"
                    >
                      Signed PDF
                    </Link>
                    <Link
                      href={`/api/loi-versions/${v.id}/download?file=certificate`}
                      className="text-primary hover:underline"
                      target="_blank"
                    >
                      Certificate
                    </Link>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <>
          <form action={genAction} className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">Generate new LOI version</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="feeAmountRupees">Fee amount (₹)</Label>
                <Input
                  id="feeAmountRupees"
                  name="feeAmountRupees"
                  type="number"
                  min="1"
                  defaultValue={expectedAmount / 100}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="territory">Territory</Label>
                <Input id="territory" name="territory" required />
              </div>
              {entityType === "COMPANY" && (
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="companyName">Company name</Label>
                  <Input id="companyName" name="companyName" />
                </div>
              )}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="commercialTerms">Commercial terms</Label>
                <Textarea id="commercialTerms" name="commercialTerms" required />
              </div>
            </div>
            {genState?.error && (
              <p className="text-sm text-destructive" role="alert">
                {genState.error}
              </p>
            )}
            <Button type="submit" disabled={genPending}>
              {genPending ? "Generating…" : currentVersion ? "Generate new version" : "Generate LOI"}
            </Button>
          </form>

          {currentVersion && currentVersion.status === "DRAFT" && (
            <form action={releaseAction} className="space-y-2 rounded-md border p-4">
              <p className="text-sm font-medium">Release v{currentVersion.versionNo}</p>
              {releaseState?.error && (
                <p className="text-sm text-destructive" role="alert">
                  {releaseState.error}
                </p>
              )}
              <Button type="submit" disabled={releasePending}>
                {releasePending ? "Releasing…" : "Release for signing"}
              </Button>
            </form>
          )}

          <form action={feeAction} className="space-y-2 rounded-md border p-4">
            <p className="text-sm font-medium">
              Update fee amount (currently {formatMoney(expectedAmount)})
            </p>
            <p className="text-xs text-muted-foreground">
              Raising the fee above the already-verified payment re-opens payment review and re-locks
              e-sign (P1-12).
            </p>
            <div className="flex items-end gap-2">
              <Input
                name="expectedAmountRupees"
                type="number"
                min="1"
                defaultValue={expectedAmount / 100}
                className="max-w-40"
              />
              <Button type="submit" variant="outline" disabled={feePending}>
                {feePending ? "Updating…" : "Update"}
              </Button>
            </div>
            {feeState?.error && (
              <p className="text-sm text-destructive" role="alert">
                {feeState.error}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  );
}
