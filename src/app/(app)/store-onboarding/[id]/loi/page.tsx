import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canViewOnboarding, canPrepareLoi } from "@/lib/permissions";
import { LoiPrepPanel } from "../loi-prep-panel";
import { LoiEditPanel } from "../loi-edit-panel";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { getTemplateSectionDefaults, LOI_SECTION_LABELS, type LoiValues } from "@/lib/onboarding/loi-pdf";
import { LOI_VERSION_STATUS_LABELS } from "@/lib/onboarding/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function OnboardingLoiPage({ params }: PageProps<"/store-onboarding/[id]/loi">) {
  const user = await requireUser();
  const { id } = await params;

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id },
    include: {
      loiVersions: { orderBy: { createdAt: "desc" } },
      currentLoiVersion: { include: { template: true } },
    },
  });
  if (!onboarding || !canViewOnboarding(user, onboarding)) {
    notFound();
  }

  const canEdit = canPrepareLoi(user);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/store-onboarding/${onboarding.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ChevronLeft className="size-4" />
          {formatOnboardingCode(onboarding.seq)} — {onboarding.brand} {onboarding.proposedLocation}
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-2xl font-semibold">LOI</h1>
          {onboarding.currentLoiVersion && (
            <Badge variant="outline">
              v{onboarding.currentLoiVersion.versionNo} — {LOI_VERSION_STATUS_LABELS[onboarding.currentLoiVersion.status]}
            </Badge>
          )}
        </div>
      </div>

      {onboarding.currentLoiVersion && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                1
              </span>
              Edit LOI
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LoiEditPanel
              onboardingId={onboarding.id}
              entityType={onboarding.entityType}
              canEdit={canEdit}
              currentVersion={{
                id: onboarding.currentLoiVersion.id,
                status: onboarding.currentLoiVersion.status,
                versionNo: onboarding.currentLoiVersion.versionNo,
                values: onboarding.currentLoiVersion.values as unknown as LoiValues,
                bodyOverrides:
                  (onboarding.currentLoiVersion.bodyOverrides as Record<string, string> | null) ?? {},
              }}
              sectionDefaults={getTemplateSectionDefaults(
                onboarding.currentLoiVersion.template.body,
                onboarding.currentLoiVersion.values as unknown as LoiValues
              )}
              sectionLabels={LOI_SECTION_LABELS}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              2
            </span>
            Release, and
            <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              3
            </span>
            new version release
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LoiPrepPanel
            onboardingId={onboarding.id}
            entityType={onboarding.entityType}
            expectedAmount={onboarding.expectedAmount}
            currentVersion={
              onboarding.currentLoiVersion
                ? {
                    id: onboarding.currentLoiVersion.id,
                    versionNo: onboarding.currentLoiVersion.versionNo,
                    status: onboarding.currentLoiVersion.status,
                    createdAt: onboarding.currentLoiVersion.createdAt.toISOString(),
                  }
                : null
            }
            allVersions={onboarding.loiVersions.map((v) => ({
              id: v.id,
              versionNo: v.versionNo,
              status: v.status,
              createdAt: v.createdAt.toISOString(),
            }))}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
