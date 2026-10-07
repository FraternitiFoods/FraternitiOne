import { StatCard } from "@/components/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Streamed in immediately on navigation while the project list query resolves. */
export default function ProjectsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-32 rounded bg-muted" />
          <div className="h-4 w-80 rounded bg-muted" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Projects" value="—" />
        <StatCard label="On Track" value="—" />
        <StatCard label="At Risk" value="—" />
        <StatCard label="Critical" value="—" />
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Project</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Ready</TableHead>
              <TableHead>Opening</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Franchisee</TableHead>
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
