import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canReviewKyc } from "@/lib/permissions";
import { decryptPan } from "@/lib/onboarding/pan-encryption";
import { FILE_KIND_LABELS, requiredKycFileKinds } from "@/lib/onboarding/kyc-requirements";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DecisionForm } from "../../decision-form";
import { decideKyc } from "../../actions";

export default async function KycReviewDetailPage({ params }: PageProps<"/reviews/kyc/[id]">) {
  const user = await requireUser();
  if (!canReviewKyc(user)) redirect("/reviews");

  const { id } = await params;
  const onboarding = await db.storeOnboarding.findUnique({
    where: { id },
    include: {
      franchisee: { select: { name: true, email: true } },
      kyc: true,
      files: { where: { supersededBy: null, kind: { not: "PAYMENT_RECEIPT" } } },
    },
  });
  if (!onboarding || !onboarding.kyc) notFound();

  let panNumber = "—";
  if (onboarding.kyc.panNumberEncrypted) {
    try {
      panNumber = decryptPan(onboarding.kyc.panNumberEncrypted);
    } catch {
      panNumber = "(decryption failed — check PAN_ENCRYPTION_KEY)";
    }
  }

  const requiredKinds = requiredKycFileKinds(onboarding.entityType);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {formatOnboardingCode(onboarding.seq)} — {onboarding.brand} {onboarding.proposedLocation}
        </h1>
        <p className="text-sm text-muted-foreground">
          {onboarding.franchisee.name} ({onboarding.franchisee.email})
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">KYC details ({onboarding.entityType})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">PAN:</span> {panNumber} ({onboarding.kyc.panName})
          </div>
          {onboarding.entityType === "INDIVIDUAL" && (
            <div>
              <span className="text-muted-foreground">Aadhaar:</span> {onboarding.kyc.aadhaarHolderName} — ****
              {onboarding.kyc.aadhaarLast4}
            </div>
          )}
          {onboarding.entityType === "COMPANY" && (
            <>
              <div>
                <span className="text-muted-foreground">Company:</span> {onboarding.kyc.companyName} (PAN:{" "}
                {onboarding.kyc.companyPan})
              </div>
              <div>
                <span className="text-muted-foreground">Authorised signatory:</span>{" "}
                {onboarding.kyc.authorisedSignatoryName}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {requiredKinds.map((kind) => {
            const file = onboarding.files.find((f) => f.kind === kind);
            return (
              <div key={kind} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span>{FILE_KIND_LABELS[kind]}</span>
                {file ? (
                  <div className="flex items-center gap-2">
                    <Badge variant={file.scanStatus === "CLEAN" ? "default" : "destructive"}>
                      {file.scanStatus}
                    </Badge>
                    <Link
                      href={`/api/onboarding-files/${file.id}/download`}
                      className="text-primary hover:underline"
                      target="_blank"
                    >
                      Open
                    </Link>
                  </div>
                ) : (
                  <span className="text-muted-foreground">Not uploaded</span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {onboarding.kyc.status === "SUBMITTED" ? (
        <DecisionForm
          action={decideKyc.bind(null, onboarding.id)}
          acceptLabel="Accept KYC"
          rejectLabel="Request changes"
          backHref="/reviews?tab=kyc"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Current status: {onboarding.kyc.status} — nothing to decide right now.
        </p>
      )}

      <Link href="/reviews?tab=kyc" className="text-sm text-muted-foreground hover:underline">
        ← Back to KYC queue
      </Link>
    </div>
  );
}
