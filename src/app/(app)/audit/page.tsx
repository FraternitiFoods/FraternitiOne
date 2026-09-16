import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatProjectCode, ROLE_LABELS } from "@/lib/format";
import type { Prisma } from "@prisma/client";

export default async function AuditPage(props: PageProps<"/audit">) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const projectParam = searchParams.project;
  const projectId = typeof projectParam === "string" ? projectParam : undefined;

  // FR-010: full audit log. Franchisees only ever see events tied to their
  // own project(s) (same isolation rule as project visibility, NFR-04);
  // every internal role can see the full log, optionally scoped by
  // ?project=<id> from a project's "Audit trail" link.
  const where: Prisma.AuditEventWhereInput =
    user.role === "FRANCHISEE"
      ? { project: { franchiseeId: user.id }, ...(projectId ? { projectId } : {}) }
      : projectId
        ? { projectId }
        : {};

  const [events, project] = await Promise.all([
    db.auditEvent.findMany({
      where,
      include: { project: { select: { seq: true, brand: true, location: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    projectId
      ? db.franchiseProject.findUnique({
          where: { id: projectId },
          select: { seq: true, brand: true, location: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Activity & Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          {project
            ? (
              <>
                Scoped to {formatProjectCode(project.seq)} — {project.brand}, {project.location}.{" "}
                <Link href="/audit" className="underline underline-offset-4">
                  View full log
                </Link>
              </>
            )
            : "Actor, timestamp, old/new value and reference for every critical change (FR-010)."}
        </p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  No audit events yet.
                </TableCell>
              </TableRow>
            )}
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {formatDateTime(event.createdAt)}
                </TableCell>
                <TableCell className="text-xs">
                  <div>{event.actorName}</div>
                  <div className="text-muted-foreground">{ROLE_LABELS[event.actorRole]}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{event.action}</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {event.entityType}
                  <div className="text-muted-foreground">{event.entityId.slice(0, 10)}…</div>
                </TableCell>
                <TableCell className="text-xs">
                  {event.project ? (
                    <Link
                      href={`/projects/${event.projectId}`}
                      className="underline underline-offset-4"
                    >
                      {formatProjectCode(event.project.seq)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="max-w-xs text-xs">
                  {event.oldValue !== null && (
                    <div className="truncate text-muted-foreground line-through decoration-1">
                      {JSON.stringify(event.oldValue)}
                    </div>
                  )}
                  {event.newValue !== null && (
                    <div className="truncate">{JSON.stringify(event.newValue)}</div>
                  )}
                  {event.reference && (
                    <div className="text-muted-foreground">{event.reference}</div>
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
