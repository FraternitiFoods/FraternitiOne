import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatProjectCode, humanize, splitPascalCase } from "@/lib/format";
import { formatPaiseAsRupees } from "@/lib/sales/format";
import { getSalesThisMonth, isOpenComplaintStatus } from "@/lib/dashboard/widgets";
import type { ComplaintStatus } from "@prisma/client";

/**
 * Dashboard home for a franchisee whose store was already built and
 * operating before joining the platform (FranchiseProject.isPreExisting —
 * see dashboard/page.tsx's branch and schema.prisma's comment on that field).
 * No readiness %, no lifecycle progress, no onboarding/KYC/LOI widgets —
 * there's no build-out to track, just day-to-day operations.
 */
export async function LegacyFranchiseeHome({
  project,
  projectsCount,
}: {
  project: {
    id: string;
    seq: number;
    brand: string;
    location: string;
    complaints: { status: ComplaintStatus }[];
  };
  projectsCount: number;
}) {
  const [salesThisMonth, documentCount, recentEvents] = await Promise.all([
    getSalesThisMonth(project.id),
    db.document.count({ where: { projectId: project.id } }),
    db.auditEvent.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  const openComplaints = project.complaints.filter((c) => isOpenComplaintStatus(c.status)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Franchise Home"
        subtitle={`${project.brand} · ${project.location} | ${formatProjectCode(project.seq)}`}
        isFranchisee
        action={
          projectsCount > 1 ? (
            <Link href="/projects" className="text-sm underline underline-offset-4">
              View all {projectsCount} projects →
            </Link>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="space-y-1 py-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Welcome back
          </p>
          <p className="text-2xl font-semibold">
            {project.brand} — {project.location}
          </p>
          <p className="text-sm text-muted-foreground">
            Your store&apos;s day-to-day — sales, complaints, and documents, all in one place.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Sales This Month"
          value={formatPaiseAsRupees(salesThisMonth.netSales)}
          caption={`${salesThisMonth.orders} orders · net`}
        />
        <StatCard
          label="Open Complaints"
          value={openComplaints}
          caption={openComplaints > 0 ? "Needs attention" : "All clear"}
          captionClassName={openComplaints > 0 ? "text-amber-600" : "text-emerald-600"}
        />
        <StatCard label="Documents" value={documentCount} caption="In your vault" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest Updates</CardTitle>
          <p className="text-xs text-muted-foreground">Recent activity on your store</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            recentEvents.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">{formatDateTime(e.createdAt)}</div>
                  <div className="font-medium">
                    {humanize(e.action)} — {splitPascalCase(e.entityType)}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {splitPascalCase(e.entityType)}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
