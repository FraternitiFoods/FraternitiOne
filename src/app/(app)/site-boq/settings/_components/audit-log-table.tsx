import type { AuditEvent } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDateTime, splitPascalCase, ROLE_LABELS } from "@/lib/format";

/**
 * plan.md section 5 "a simple viewer [for the audit log] in Settings" —
 * Admin only (gated by the caller). Each row's raw old/new JSON is tucked
 * into a native <details> so the table stays scannable; no extra JS needed.
 */
export function AuditLogTable({ events }: { events: AuditEvent[] }) {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>When</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Changes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No edits recorded yet.
              </TableCell>
            </TableRow>
          )}
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="text-muted-foreground whitespace-nowrap">{formatDateTime(event.createdAt)}</TableCell>
              <TableCell>
                <div>{event.actorName}</div>
                <div className="text-xs text-muted-foreground">{ROLE_LABELS[event.actorRole]}</div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {splitPascalCase(event.entityType)}
                <div className="text-xs">{event.entityId.slice(0, 12)}</div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{event.action}</Badge>
              </TableCell>
              <TableCell className="max-w-48 truncate text-muted-foreground">{event.reference || "—"}</TableCell>
              <TableCell>
                <details>
                  <summary className="cursor-pointer text-xs text-primary select-none">View</summary>
                  <pre className="mt-1 max-w-sm overflow-x-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap">
                    {JSON.stringify({ old: event.oldValue, new: event.newValue }, null, 2)}
                  </pre>
                </details>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
