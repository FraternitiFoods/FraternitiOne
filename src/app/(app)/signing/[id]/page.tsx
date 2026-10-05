import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canCompanySign } from "@/lib/permissions";
import { canCompanySignNow } from "@/lib/onboarding/state";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { LOI_VERSION_STATUS_LABELS } from "@/lib/onboarding/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanySignButton } from "./company-sign-button";

export default async function SigningDetailPage({ params }: PageProps<"/signing/[id]">) {
  const user = await requireUser();
  if (!canCompanySign(user)) redirect("/dashboard");

  const { id } = await params;
  const onboarding = await db.storeOnboarding.findUnique({
    where: { id },
    include: {
      currentLoiVersion: { include: { attempts: { orderBy: { attemptNo: "desc" } } } },
    },
  });
  const version = onboarding?.currentLoiVersion;
  if (!onboarding || !version) notFound();

  const franchiseAttempt = version.attempts.find((a) => a.signerRole === "FRANCHISEE") ?? null;
  const latestCompanyAttempt = version.attempts.find((a) => a.signerRole === "COMPANY") ?? null;

  const canSign = canCompanySignNow({
    actorRole: user.role,
    actorUserId: user.id,
    invitedSignerUserId: latestCompanyAttempt?.signerUserId ?? null,
    franchiseAttempt: franchiseAttempt
      ? { status: franchiseAttempt.status, loiVersionId: franchiseAttempt.loiVersionId, pdfSha256: franchiseAttempt.pdfSha256 }
      : null,
    loiVersion: { id: version.id, pdfSha256: version.pdfSha256 },
    latestCompanyAttemptStatus: latestCompanyAttempt?.status ?? null,
  });

  const isSigningInFlight = latestCompanyAttempt?.status === "SENT" || latestCompanyAttempt?.status === "IN_PROGRESS";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {formatOnboardingCode(onboarding.seq)} — {onboarding.brand} {onboarding.proposedLocation}
        </h1>
        <Badge variant="outline">{LOI_VERSION_STATUS_LABELS[version.status]}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">LOI v{version.versionNo}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Link
            href={`/api/loi-versions/${version.id}/download`}
            className="text-primary hover:underline"
            target="_blank"
          >
            Preview LOI (PDF)
          </Link>
          <p className="text-sm text-muted-foreground">
            Franchisee attempt: {franchiseAttempt?.status ?? "not started"}
          </p>

          {isSigningInFlight ? (
            <p className="text-sm text-muted-foreground">Signing in progress — check back shortly.</p>
          ) : latestCompanyAttempt?.status === "COMPLETED" ? (
            <div className="space-y-2">
              <p className="text-sm text-emerald-600">Signed.</p>
              {onboarding.projectId && (
                <Link
                  href={`/projects/${onboarding.projectId}`}
                  className="text-sm text-primary underline underline-offset-4"
                >
                  View project →
                </Link>
              )}
            </div>
          ) : (
            <CompanySignButton onboardingId={onboarding.id} canSign={canSign} />
          )}
        </CardContent>
      </Card>

      <Link href="/signing" className="text-sm text-muted-foreground hover:underline">
        ← Back to Signing Queue
      </Link>
    </div>
  );
}
