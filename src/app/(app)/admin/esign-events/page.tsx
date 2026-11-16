import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageOnboardingAdmin } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentProviderName } from "@/lib/esign";
import { getLeegalityWalletBalance } from "@/lib/esign/leegality-provider";
import { currentScannerName } from "@/lib/malware-scan";
import { ReconcileButton } from "./reconcile-button";

/** plan.md section 17, P1-10: webhook log, visible to Admin, retryable via Reconcile. */
export default async function EsignEventsPage() {
  const user = await requireUser();
  if (!canManageOnboardingAdmin(user)) redirect("/dashboard");

  const providerName = currentProviderName();
  // plan.md section 19 API contract "wallet line" — cached 5 min inside
  // getLeegalityWalletBalance, failure returns null and is ignored (never
  // blocks this page or any signing flow).
  const walletBalance = providerName === "leegality" ? await getLeegalityWalletBalance() : null;
  const lowCreditsThreshold = Number(process.env.LEEGALITY_LOW_CREDITS || "10");

  const events = await db.esignEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: 200,
    include: {
      attempt: { include: { loiVersion: { include: { onboarding: true } } } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">E-sign Events</h1>
        <p className="text-sm text-muted-foreground">
          E-sign provider: <Badge variant="outline">{providerName}</Badge>
        </p>
      </div>

      {providerName === "leegality" && walletBalance !== null && walletBalance < lowCreditsThreshold && (
        <p className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Leegality wallet balance is low: <strong>{walletBalance}</strong> eSign credits left (each LOI uses 2).
          Top up soon to avoid signing failures.
        </p>
      )}

      {currentScannerName() === "basic" && (
        <p className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Malware scanning is running on the &quot;basic&quot; checker (type/magic-byte + EICAR only) — not
          configured for production use.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Envelope</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Error</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-xs">{formatDateTime(e.receivedAt)}</TableCell>
                <TableCell className="text-xs">
                  {e.attempt
                    ? `${formatOnboardingCode(e.attempt.loiVersion.onboarding.seq)} — ${e.attempt.loiVersion.onboarding.brand}`
                    : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline">{e.provider}</Badge>
                </TableCell>
                <TableCell className="max-w-40 truncate text-xs" title={e.envelopeId}>
                  {e.envelopeId}
                </TableCell>
                <TableCell>
                  <Badge variant={e.processingStatus === "PROCESSED" ? "default" : "destructive"}>
                    {e.processingStatus}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-56 truncate text-xs text-destructive" title={e.error ?? ""}>
                  {e.error}
                </TableCell>
                <TableCell>
                  {e.attempt &&
                    (e.processingStatus === "FAILED" || e.processingStatus === "IGNORED_LATE") && (
                      <ReconcileButton attemptId={e.attempt.id} />
                    )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
