import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canViewOnboarding } from "@/lib/permissions";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import {
  ONBOARDING_STATUS_LABELS,
  ONBOARDING_ACCOUNT_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  LOI_VERSION_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  formatMoney,
} from "@/lib/onboarding/format";
import { formatDateTime, splitPascalCase } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "cn";

export default async function StoreOnboardingDetailPage({
  params,
  searchParams,
}: PageProps<"/store-onboarding/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const search = await searchParams;

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id },
    include: {
      franchisee: { select: { id: true, name: true, email: true } },
      salesOwner: { select: { id: true, name: true, email: true } },
      kyc: true,
      payments: { orderBy: { createdAt: "desc" } },
      currentLoiVersion: true,
    },
  });

  if (!onboarding || !canViewOnboarding(user, onboarding)) {
    notFound();
  }

  const auditEvents = await db.auditEvent.findMany({
    where: { onboardingId: onboarding.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Same aggregation lib/onboarding/recompute.ts uses for the e-sign gate —
  // a franchisee can pay across multiple accepted submissions, so the total
  // (not just the latest payment's verifiedAmount) is the number that matters.
  const totalVerified = onboarding.payments.reduce((sum, p) => sum + (p.verifiedAmount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {formatOnboardingCode(onboarding.seq)} — {onboarding.brand} {onboarding.proposedLocation}
          </h1>
          <p className="text-sm text-muted-foreground">
            {onboarding.projectId ? (
              <>
                Project:{" "}
                <Link href={`/projects/${onboarding.projectId}`} className="underline underline-offset-4">
                  View project →
                </Link>
              </>
            ) : (
              <>
                Reserved Project ID: <code>{onboarding.reservedProjectId}</code>
              </>
            )}
          </p>
        </div>
        <Badge variant="outline">{ONBOARDING_STATUS_LABELS[onboarding.onboardingStatus]}</Badge>
      </div>

      {search.inviteError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          The store and franchisee account were created, but the invite email failed to send. Check
          RESEND_API_KEY / EMAIL_FROM in .env and resend the invite from the franchisee&apos;s account.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Store &amp; applicant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">Legal applicant:</span>{" "}
              {onboarding.legalApplicantName}
            </div>
            <div>
              <span className="text-muted-foreground">Entity type:</span>{" "}
              {ENTITY_TYPE_LABELS[onboarding.entityType]}
            </div>
            <div>
              <span className="text-muted-foreground">Format:</span> {onboarding.format}
            </div>
            <div>
              <span className="text-muted-foreground">Contact phone:</span> {onboarding.contactPhone}
            </div>
            <div>
              <span className="text-muted-foreground">Fee amount:</span>{" "}
              {formatMoney(onboarding.expectedAmount)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">People</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">Franchisee:</span> {onboarding.franchisee.name} (
              {onboarding.franchisee.email})
            </div>
            <div>
              <span className="text-muted-foreground">Workspace email:</span> {onboarding.workspaceEmail}
            </div>
            <div>
              <span className="text-muted-foreground">Account status:</span>{" "}
              {ONBOARDING_ACCOUNT_STATUS_LABELS[onboarding.accountStatus]}
            </div>
            <div>
              <span className="text-muted-foreground">Sales owner:</span> {onboarding.salesOwner.name}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ClickableCard href={`/store-onboarding/${onboarding.id}/kyc`} title="KYC">
          <div>
            <span className="text-muted-foreground">Status:</span>{" "}
            {REVIEW_STATUS_LABELS[onboarding.kycStatus]}
          </div>
          {onboarding.kyc?.decisionReason && (
            <div>
              <span className="text-muted-foreground">Last reviewer note:</span>{" "}
              {onboarding.kyc.decisionReason}
            </div>
          )}
        </ClickableCard>

        <ClickableCard href={`/store-onboarding/${onboarding.id}/payment`} title="Payment">
          <div>
            <span className="text-muted-foreground">Status:</span>{" "}
            {REVIEW_STATUS_LABELS[onboarding.paymentStatus]}
          </div>
          <div>
            <span className="text-muted-foreground">Verified so far:</span> {formatMoney(totalVerified)} of{" "}
            {formatMoney(onboarding.expectedAmount)}
          </div>
        </ClickableCard>
      </div>

      <ClickableCard
        href={`/store-onboarding/${onboarding.id}/loi`}
        title="LOI"
        className="md:max-w-sm"
      >
        <div>
          <span className="text-muted-foreground">Status:</span>{" "}
          {onboarding.currentLoiVersion
            ? `v${onboarding.currentLoiVersion.versionNo} — ${LOI_VERSION_STATUS_LABELS[onboarding.currentLoiVersion.status]}`
            : "Not generated"}
        </div>
      </ClickableCard>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit trail</CardTitle>
        </CardHeader>
        <CardContent>
          {auditEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {auditEvents.map((e) => (
                <li key={e.id} className="border-b pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {e.action} — {splitPascalCase(e.entityType)}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.actorName} ({e.actorEmail}) {e.reference ? `— ${e.reference}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Link href="/store-onboarding" className="text-sm text-muted-foreground hover:underline">
        ← Back to Store Onboarding
      </Link>
    </div>
  );
}

/** A Card that's an obvious link — drills into a dedicated sub-page instead of showing everything inline. */
function ClickableCard({
  href,
  title,
  className,
  children,
}: {
  href: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn("block transition-colors hover:bg-muted/50", className)}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            {title}
            <ChevronRight className="size-4 text-muted-foreground" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">{children}</CardContent>
      </Card>
    </Link>
  );
}
