import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canFranchiseeSignNow } from "@/lib/onboarding/state";
import { LOI_VERSION_STATUS_LABELS } from "@/lib/onboarding/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FranchiseeSignButton } from "./franchisee-sign-button";

export default async function OnboardingLoiPage() {
  const user = await requireUser();

  const onboarding = await db.storeOnboarding.findUniqueOrThrow({
    where: { franchiseeUserId: user.id },
    include: {
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      currentLoiVersion: {
        include: { attempts: { where: { signerRole: "FRANCHISEE" }, orderBy: { attemptNo: "desc" }, take: 1 } },
      },
    },
  });

  const version = onboarding.currentLoiVersion;
  const latestAttempt = version?.attempts[0] ?? null;

  const canSign = version
    ? canFranchiseeSignNow({
        kycStatus: onboarding.kycStatus,
        paymentStatus: onboarding.paymentStatus,
        verifiedAmount: onboarding.payments[0]?.verifiedAmount ?? null,
        expectedAmount: onboarding.expectedAmount,
        loiVersionStatus: version.status,
        latestFranchiseAttemptStatus: latestAttempt?.status ?? null,
      })
    : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">LOI &amp; E-Sign</h1>
      </div>

      {!version ? (
        <p className="text-sm text-muted-foreground">
          Your Letter of Intent hasn&apos;t been prepared yet — check back once your KYC and payment are
          accepted.
        </p>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">LOI v{version.versionNo}</CardTitle>
            <Badge variant="outline">{LOI_VERSION_STATUS_LABELS[version.status]}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link
              href={`/api/loi-versions/${version.id}/download`}
              className="text-primary hover:underline"
              target="_blank"
            >
              Preview LOI (PDF)
            </Link>

            {version.status === "SIGNED" && (
              <div className="space-y-1">
                <Link
                  href={`/api/loi-versions/${version.id}/download?file=signed`}
                  className="block text-primary hover:underline"
                  target="_blank"
                >
                  Download signed LOI
                </Link>
                <Link
                  href={`/api/loi-versions/${version.id}/download?file=certificate`}
                  className="block text-primary hover:underline"
                  target="_blank"
                >
                  Download signing certificate
                </Link>
              </div>
            )}

            <FranchiseeSignButton
              onboardingId={onboarding.id}
              canSign={canSign}
              attemptStatus={latestAttempt?.status ?? null}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
