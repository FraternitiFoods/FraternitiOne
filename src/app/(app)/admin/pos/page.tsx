import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManagePosIntegration } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatProjectCode } from "@/lib/format";
import { dateKeyToDate, toUtcDateKey } from "@/lib/sales/parse-csv";
import { istTodayKey } from "@/lib/pos/petpooja-parse";
import { OutletMappingDialog } from "./outlet-mapping-dialog";
import { ReprocessButton } from "./reprocess-button";
import { UnpinButton } from "./unpin-button";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MISMATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/// Bounds the "last bill per outlet" lookup so it doesn't scan PosOrder's
/// entire history (per-bill ledger, "hundreds of bills a day" per store —
/// see schema comment). Any outlet truly silent for 90 days is already
/// flagged by the 24h badge below regardless of whether we can show its
/// exact last-bill timestamp, so bounding this window changes no outcome
/// that matters operationally.
const LAST_BILL_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * plan.md section 26 `/admin/pos` — Admin-only (`canManagePosIntegration`):
 * outlet mapping, health, problem events + reprocess, webhook URL. Event
 * payloads here are already scrubbed before storage (webhook-processor.ts) —
 * nothing on this page can contain Customer data, `comment` or a token.
 */
export default async function AdminPosPage() {
  const user = await requireUser();
  if (!canManagePosIntegration(user)) redirect("/dashboard");

  const now = new Date();
  const todayDate = dateKeyToDate(istTodayKey(now));
  const mismatchSince = new Date(now.getTime() - MISMATCH_WINDOW_MS);

  const lastBillLookbackSince = new Date(now.getTime() - LAST_BILL_LOOKBACK_MS);

  const [projects, billsTodayGroups, lastBillGroups, mismatchCount, pinnedDays, problemEvents] = await Promise.all([
    db.franchiseProject.findMany({
      select: { id: true, seq: true, brand: true, location: true, petpoojaRestId: true, posLiveFrom: true },
      orderBy: { seq: "asc" },
    }),
    db.posOrder.groupBy({ by: ["projectId"], where: { businessDate: todayDate }, _count: { _all: true } }),
    db.posOrder.groupBy({
      by: ["projectId"],
      where: { receivedAt: { gte: lastBillLookbackSince } },
      _max: { receivedAt: true },
    }),
    db.posOrder.count({ where: { flags: { has: "TOTAL_MISMATCH" }, receivedAt: { gte: mismatchSince } } }),
    db.salesDay.findMany({
      where: { isPinned: true },
      select: { id: true, projectId: true, date: true, updatedAt: true },
      orderBy: { date: "desc" },
    }),
    db.posWebhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 100 }),
  ]);

  const billsTodayByProject = new Map(billsTodayGroups.map((g) => [g.projectId, g._count._all]));
  const lastBillByProject = new Map(lastBillGroups.map((g) => [g.projectId, g._max.receivedAt]));

  const mappedProjects = projects.filter((p) => p.petpoojaRestId);
  const silentOutlets = mappedProjects.filter((p) => {
    const last = lastBillByProject.get(p.id);
    return !last || now.getTime() - last.getTime() > TWENTY_FOUR_HOURS_MS;
  });

  // Each pinned day has its own cutoff (`updatedAt`), so this can't be a
  // single flat `where` — but it's still one aggregate query instead of one
  // `count()` per pinned day (was a real N+1; see plan.md performance pass).
  const newBillGroups = pinnedDays.length
    ? await db.posOrder.groupBy({
        by: ["projectId", "businessDate"],
        where: {
          OR: pinnedDays.map((d) => ({
            projectId: d.projectId,
            businessDate: d.date,
            receivedAt: { gt: d.updatedAt },
          })),
        },
        _count: { _all: true },
      })
    : [];
  const newBillCountByKey = new Map(
    newBillGroups.map((g) => [`${g.projectId}:${g.businessDate.toISOString()}`, g._count._all])
  );
  const pinnedWithNewBills = pinnedDays.map((d) => ({
    ...d,
    project: projects.find((p) => p.id === d.projectId),
    newBillCount: newBillCountByKey.get(`${d.projectId}:${d.date.toISOString()}`) ?? 0,
  }));
  const pinnedToShow = pinnedWithNewBills.filter((d) => d.newBillCount > 0);

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const webhookUrl = `${appUrl}/api/webhooks/petpooja`;
  const pathSecretConfigured = !!process.env.PETPOOJA_WEBHOOK_PATH_SECRET;
  const tokenConfigured = !!process.env.PETPOOJA_WEBHOOK_TOKEN;
  const webhookEnabled = process.env.PETPOOJA_WEBHOOK_ENABLED === "true";

  return (
    <div className="space-y-6">
      <PageHeader
        title="POS (Petpooja)"
        subtitle="Live sales feed — outlet mapping, health and problem events (plan.md section 26)."
        isFranchisee={false}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook URL</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={webhookEnabled ? "default" : "destructive"}>
              {webhookEnabled ? "Enabled" : "Disabled"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {webhookEnabled ? "Live — accepting bills." : "PETPOOJA_WEBHOOK_ENABLED is not \"true\" — the route answers 404."}
            </span>
          </div>
          <Input readOnly value={webhookUrl} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">
            {tokenConfigured && "A body token is configured — give Petpooja this URL and the token separately."}
            {tokenConfigured && pathSecretConfigured && " "}
            {pathSecretConfigured &&
              `A URL path secret is also configured — the URL to give Petpooja is this one with "/<the secret>" appended. The secret itself is never shown here; it's in the Vercel env vars.`}
            {!tokenConfigured && !pathSecretConfigured && (
              <span className="text-destructive">
                Neither PETPOOJA_WEBHOOK_TOKEN nor PETPOOJA_WEBHOOK_PATH_SECRET is configured — the route will answer
                503 until one is set.
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Outlets mapped" value={mappedProjects.length} caption={`of ${projects.length} stores`} />
        <StatCard
          label="Silent > 24h"
          value={silentOutlets.length}
          caption="mapped outlets with no bill in the last day"
          captionClassName={silentOutlets.length > 0 ? "text-destructive" : undefined}
        />
        <StatCard
          label="TOTAL_MISMATCH (7d)"
          value={mismatchCount}
          caption="bills whose total didn't cross-check — not rejected, just flagged"
        />
      </div>

      {pinnedToShow.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pinned days with new bills since</CardTitle>
            <p className="text-xs text-muted-foreground">
              A manual edit or CSV import pinned these days — new POS bills are still arriving but not changing the
              pinned total.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Store</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>New bills since pin</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pinnedToShow.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs">{d.project ? `${d.project.brand} — ${d.project.location}` : "—"}</TableCell>
                    <TableCell className="text-xs">{formatDate(d.date)}</TableCell>
                    <TableCell className="text-xs">{d.newBillCount}</TableCell>
                    <TableCell>
                      <UnpinButton salesDayId={d.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outlet mapping</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Store</TableHead>
                <TableHead>Petpooja restID</TableHead>
                <TableHead>Go-live (IST)</TableHead>
                <TableHead>Last bill</TableHead>
                <TableHead>Bills today</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => {
                const lastBill = lastBillByProject.get(p.id);
                const isSilent = p.petpoojaRestId && (!lastBill || now.getTime() - lastBill.getTime() > TWENTY_FOUR_HOURS_MS);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">
                      {p.brand} — {p.location}
                      <div className="text-[10px] text-muted-foreground">{formatProjectCode(p.seq)}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.petpoojaRestId ?? <span className="text-muted-foreground">not mapped</span>}
                    </TableCell>
                    <TableCell className="text-xs">{p.posLiveFrom ? formatDate(p.posLiveFrom) : "—"}</TableCell>
                    <TableCell className="text-xs">
                      {lastBill ? (
                        <span className={isSilent ? "text-destructive" : undefined}>{formatDateTime(lastBill)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{billsTodayByProject.get(p.id) ?? 0}</TableCell>
                    <TableCell>
                      <OutletMappingDialog
                        projectId={p.id}
                        storeLabel={`${p.brand} — ${p.location} (${formatProjectCode(p.seq)})`}
                        petpoojaRestId={p.petpoojaRestId}
                        posLiveFrom={p.posLiveFrom ? toUtcDateKey(p.posLiveFrom) : null}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Problem events</CardTitle>
          <p className="text-xs text-muted-foreground">
            Most recent 100. A clean bill is never logged here — <code>PosOrder</code> itself is the ledger.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Received</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>restID</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Reprocessed</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {problemEvents.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No problem events — every bill that arrived was stored cleanly.
                    </TableCell>
                  </TableRow>
                )}
                {problemEvents.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDateTime(e.receivedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={e.outcome === "REJECTED_AUTH" ? "destructive" : "outline"}>{e.outcome}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{e.restId ?? "—"}</TableCell>
                    <TableCell className="max-w-56 truncate text-xs text-destructive" title={e.error ?? ""}>
                      {e.error ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{e.reprocessedAt ? formatDateTime(e.reprocessedAt) : "—"}</TableCell>
                    <TableCell>
                      {e.payload !== null && !e.reprocessedAt && <ReprocessButton eventId={e.id} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
