import { StatCard } from "@/components/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Streamed in immediately on navigation while the onboarding list query resolves. */
export default function StoreOnboardingLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-4 w-96 rounded bg-muted" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Onboardings" value="—" />
        <StatCard label="KYC Pending" value="—" />
        <StatCard label="Payment Pending" value="—" />
        <StatCard label="LOI Pending" value="—" />
        <StatCard label="Converted (LOI Complete)" value="—" />
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Onboarding</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>KYC</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>LOI</TableHead>
              <TableHead>Franchisee</TableHead>
              <TableHead>Sales Owner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7}>
                  <div className="h-5 w-full rounded bg-muted" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
