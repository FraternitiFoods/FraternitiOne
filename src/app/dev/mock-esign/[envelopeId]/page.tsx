import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { MockEsignControls } from "./mock-esign-controls";

/**
 * plan.md section 17: the mock provider's fake signing page. Refuses to
 * render its real controls outside dev/mock (see also the actions.ts and
 * getEsignProvider() guards — this is defense in depth, not the only gate).
 * No app session/auth here on purpose: this page stands in for an
 * *external* vendor's signing page, which wouldn't carry our cookie either.
 */
export default async function MockEsignPage({ params }: PageProps<"/dev/mock-esign/[envelopeId]">) {
  const { envelopeId } = await params;

  const unavailable = process.env.NODE_ENV === "production" || process.env.ESIGN_PROVIDER !== "mock";

  const attempt = unavailable
    ? null
    : await db.esignAttempt.findFirst({
        where: { providerEnvelopeId: envelopeId },
        include: { loiVersion: { include: { onboarding: true } } },
      });

  if (unavailable) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">Mock e-sign not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Mock signatures have no legal value and are refused outside development
          (ESIGN_PROVIDER=mock, non-production only).
        </p>
      </div>
    );
  }

  if (!attempt) notFound();

  return (
    <div className="mx-auto max-w-md space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold">Mock Aadhaar e-sign</h1>
        <p className="mt-1 text-xs font-medium text-destructive">
          TEST SIGNATURE — this has no legal value and is not production sign-off.
        </p>
      </div>
      <div className="rounded-md border p-4 text-sm">
        <div>
          Store: {attempt.loiVersion.onboarding.brand} {attempt.loiVersion.onboarding.proposedLocation}
        </div>
        <div>LOI version: {attempt.loiVersion.versionNo}</div>
        <div>Signer role: {attempt.signerRole}</div>
        <div>Envelope: {envelopeId}</div>
      </div>
      <MockEsignControls envelopeId={envelopeId} />
    </div>
  );
}
