import Link from "next/link";
import { forbidden } from "next/navigation";
import { requireOnboardingUser } from "@/lib/onboarding-access";
import { db } from "@/lib/db";
import { canCompanySign } from "@/lib/permissions";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { LOI_VERSION_STATUS_LABELS } from "@/lib/onboarding/format";
import { Badge } from "@/components/ui/badge";

/** Company signatory queue (wireframe 07) — every LOI version whose franchisee attempt has completed. */
export default async function SigningQueuePage() {
  const user = await requireOnboardingUser();
  if (!canCompanySign(user)) forbidden();

  const versions = await db.loiVersion.findMany({
    where: { status: { in: ["FRANCHISE_SIGNED"] } },
    select: {
      id: true,
      versionNo: true,
      status: true,
      onboarding: { select: { id: true, seq: true, brand: true, proposedLocation: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Signing Queue</h1>
        <p className="text-sm text-muted-foreground">
          LOIs where the franchisee has signed and a company countersignature is needed.
        </p>
      </div>

      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <div className="space-y-2">
          {versions.map((v) => (
            <Link
              key={v.id}
              href={`/signing/${v.onboarding.id}`}
              className="block rounded-md border p-3 text-sm hover:bg-muted"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {formatOnboardingCode(v.onboarding.seq)} — {v.onboarding.brand} {v.onboarding.proposedLocation}{" "}
                  (v{v.versionNo})
                </span>
                <Badge variant="outline">{LOI_VERSION_STATUS_LABELS[v.status]}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
