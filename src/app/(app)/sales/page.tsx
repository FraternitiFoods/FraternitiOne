import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageSales, canViewSales } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatProjectCode } from "@/lib/format";
import { toUtcDateKey } from "@/lib/sales/parse-csv";
import { computeDailyTrend, computeMonthlyBars, computePeriodCards, type SalesDayLike } from "@/lib/sales/aggregate";
import { formatPaiseAsRupees, computeAovPaise } from "@/lib/sales/format";
import { ManualSalesDayDialog } from "./manual-sales-day-dialog";
import type { Prisma, Role } from "@prisma/client";

/**
 * Roles with ANY path into /sales at all (section 20A). Anyone else is
 * bounced to /dashboard — same "this page isn't for you" shape as
 * /users (canManageUsers). `canViewSales` does the finer per-project check
 * once a project is in scope.
 */
const SALES_VIEWABLE_ROLES: Role[] = ["FRANCHISEE", "SALES", "ADMIN", "MANAGEMENT", "ACCOUNTS"];

export default async function SalesPage(props: PageProps<"/sales">) {
  const user = await requireUser();
  if (!SALES_VIEWABLE_ROLES.includes(user.role)) {
    redirect("/dashboard");
  }

  const searchParams = await props.searchParams;
  const projectParam = searchParams.project;
  let activeProjectId = typeof projectParam === "string" ? projectParam : undefined;

  // No explicit ?project= — a franchisee auto-picks their own (most recent)
  // project; every other viewable role falls through to the role-scoped
  // list/picker below when nothing's been chosen yet.
  if (!activeProjectId && user.role === "FRANCHISEE") {
    const own = await db.franchiseProject.findFirst({
      where: { franchiseeId: user.id },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    activeProjectId = own?.id;
  }

  // Resolving a *specific* project (whether from ?project= or a franchisee's
  // own) happens before any "do I even have a store" list check — a SALES
  // user who owns zero stores must still get notFound() (not a generic empty
  // state) when probing another store's id by URL (section 20A cause ->
  // effect #3). Earlier code short-circuited to the empty state whenever the
  // role-scoped picker list was empty, which skipped this check entirely —
  // fixed during verification, see plan.md section 20A build log.
  if (activeProjectId) {
    const project = await db.franchiseProject.findUnique({
      where: { id: activeProjectId },
      select: {
        id: true,
        seq: true,
        brand: true,
        location: true,
        franchiseeId: true,
        onboarding: { select: { salesOwnerId: true } },
      },
    });

    // Same notFound() convention as canViewProject — a franchisee or an
    // unassigned SALES user hitting another store's id by URL sees "not
    // found", not a permission error that confirms the store exists.
    if (!project || !canViewSales(user, project)) {
      notFound();
    }
    return renderSalesPage(user, project);
  }

  // Nothing resolved yet: either a franchisee with no project at all, or an
  // internal role that hasn't picked a store — scope the list/picker to this
  // role (section 20A cause -> effect #3: a franchisee/unassigned SALES user
  // must not even see another store's project in the picker).
  const projectWhere: Prisma.FranchiseProjectWhereInput =
    user.role === "FRANCHISEE"
      ? { franchiseeId: user.id }
      : user.role === "SALES"
        ? { onboarding: { salesOwnerId: user.id } }
        : {};

  const projects = await db.franchiseProject.findMany({
    where: projectWhere,
    select: { id: true, seq: true, brand: true, location: true },
    orderBy: { createdAt: "desc" },
  });

  if (projects.length === 0) {
    return (
      <div>
        <PageHeader title="Sales" isFranchisee={user.role === "FRANCHISEE"} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {user.role === "FRANCHISEE"
              ? "No franchise project is linked to your account yet."
              : "No stores assigned to you yet."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Sales" subtitle="Pick a store to see its sales" isFranchisee={false} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/sales?project=${project.id}`}
            className="block rounded-lg border p-4 transition-colors hover:border-primary/40 hover:shadow-sm"
          >
            <div className="text-sm font-medium">
              {project.brand} — {project.location}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{formatProjectCode(project.seq)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

type SalesProject = {
  id: string;
  seq: number;
  brand: string;
  location: string;
  franchiseeId: string;
  onboarding: { salesOwnerId: string } | null;
};

async function renderSalesPage(user: Awaited<ReturnType<typeof requireUser>>, project: SalesProject) {

  const canManage = canManageSales(user);

  const rows = await db.salesDay.findMany({
    where: { projectId: project.id },
    orderBy: { date: "desc" },
  });

  const now = new Date();
  const rowsLike: SalesDayLike[] = rows.map((r) => ({
    date: toUtcDateKey(r.date),
    grossSales: r.grossSales,
    netSales: r.netSales,
    orders: r.orders,
  }));

  const periods = computePeriodCards(rowsLike, now);
  const trend = computeDailyTrend(rowsLike, now, 30);
  const monthlyBars = computeMonthlyBars(rowsLike, now);
  const maxTrendValue = Math.max(1, ...trend.map((p) => p.netSales));
  const maxMonthlyValue = Math.max(1, ...monthlyBars.map((p) => p.netSales));

  const recentRows = rows.slice(0, 30);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        subtitle={
          <>
            {project.brand} — {project.location} · {formatProjectCode(project.seq)}. Revenue only — no cost, P&amp;L
            or royalty figures.
          </>
        }
        isFranchisee={user.role === "FRANCHISEE"}
        action={
          <div className="flex items-center gap-3">
            {user.role !== "FRANCHISEE" && (
              <Link href="/sales" className="text-sm underline underline-offset-4">
                Switch store →
              </Link>
            )}
            {canManage && (
              <>
                <Link href={`/sales/import?project=${project.id}`}>
                  <span className="text-sm underline underline-offset-4">Import CSV →</span>
                </Link>
                <ManualSalesDayDialog
                  projectId={project.id}
                  redirectTo={`/sales?project=${project.id}`}
                  triggerLabel="Add a day"
                  triggerSize="sm"
                />
              </>
            )}
          </div>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No sales recorded yet.
            {canManage && " Import a CSV or add a day manually to get started."}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <PeriodCard label="Today" totals={periods.today} />
            <PeriodCard label="Yesterday" totals={periods.yesterday} />
            <PeriodCard label="This Month" totals={periods.thisMonth} />
            <PeriodCard label="This Year" totals={periods.thisYear} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <PeriodCard label="Last Month" totals={periods.lastMonth} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Last 30 Days — Net Sales</CardTitle>
                <p className="text-xs text-muted-foreground">Daily trend, zero-filled for days with no data</p>
              </CardHeader>
              <CardContent>
                <div className="flex h-32 items-end gap-0.5">
                  {trend.map((point) => (
                    <div
                      key={point.date}
                      title={`${point.date}: ${formatPaiseAsRupees(point.netSales)}`}
                      className="min-w-[2px] flex-1 rounded-t bg-primary/70"
                      style={{ height: `${Math.max(2, Math.round((point.netSales / maxTrendValue) * 100))}%` }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                  <span>{trend[0]?.date}</span>
                  <span>{trend[trend.length - 1]?.date}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">This Year — Net Sales by Month</CardTitle>
                <p className="text-xs text-muted-foreground">Zero-filled for months with no data</p>
              </CardHeader>
              <CardContent>
                <div className="flex h-32 items-end gap-2">
                  {monthlyBars.map((bar) => (
                    <div key={bar.month} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        title={`${bar.month}: ${formatPaiseAsRupees(bar.netSales)}`}
                        className="w-full rounded-t bg-primary/70"
                        style={{ height: `${Math.max(2, Math.round((bar.netSales / maxMonthlyValue) * 100))}%` }}
                      />
                      <span className="text-[9px] text-muted-foreground">{bar.month.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Days</CardTitle>
              <p className="text-xs text-muted-foreground">Most recent {recentRows.length} recorded days</p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Date</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>AOV</TableHead>
                    <TableHead>Source</TableHead>
                    {canManage && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRows.map((row) => {
                    const dateKey = toUtcDateKey(row.date);
                    const aov = computeAovPaise(row.netSales, row.orders);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs">{formatDate(row.date)}</TableCell>
                        <TableCell className="text-xs">{formatPaiseAsRupees(row.grossSales)}</TableCell>
                        <TableCell className="text-xs">{formatPaiseAsRupees(row.netSales)}</TableCell>
                        <TableCell className="text-xs">{row.orders}</TableCell>
                        <TableCell className="text-xs">{aov === null ? "—" : formatPaiseAsRupees(aov)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.source}</TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <ManualSalesDayDialog
                              projectId={project.id}
                              redirectTo={`/sales?project=${project.id}`}
                              triggerLabel="Edit"
                              triggerVariant="ghost"
                              triggerSize="xs"
                              existingDay={{
                                date: dateKey,
                                grossSalesRupees: (row.grossSales / 100).toString(),
                                netSalesRupees: (row.netSales / 100).toString(),
                                orders: row.orders,
                              }}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function PeriodCard({
  label,
  totals,
}: {
  label: string;
  totals: { grossSales: number; netSales: number; orders: number };
}) {
  const aov = computeAovPaise(totals.netSales, totals.orders);
  return (
    <StatCard
      label={label}
      value={formatPaiseAsRupees(totals.netSales)}
      caption={
        <>
          Gross {formatPaiseAsRupees(totals.grossSales)} · {totals.orders} orders · AOV{" "}
          {aov === null ? "—" : formatPaiseAsRupees(aov)}
        </>
      }
    />
  );
}
