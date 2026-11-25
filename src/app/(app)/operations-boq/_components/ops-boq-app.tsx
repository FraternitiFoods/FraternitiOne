"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, LockIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";
import { advanceExceedsAmount, isFollowUpOverdue, pendingAmount, sharedCount, totalsOf } from "@/lib/ops-boq-calc";
import { OPS_BOQ_NAME_MAX, parseOpsBoqCell, parseOpsBoqName, type OpsBoqEditableField } from "@/lib/ops-boq-input";
import type { OpsBoqRowView } from "@/lib/ops-boq-data";
import { addOpsBoqRow, deleteOpsBoqRow, renameOpsBoqRow, updateOpsBoqCell } from "../actions";
import { EditableCell, LinkCell } from "./ops-boq-cells";

type SiteOption = { id: string; name: string };

const LAST_SITE_KEY = "opsBoq:lastSiteId";
const STATUS_LABELS = { NOT_SHARED: "NOT SHARED", SHARED: "SHARED" } as const;

/** Money for display: whole rupees stay whole, paise are shown only when present. */
function money(value: number | null): string {
  return value === null ? "" : formatCurrency(value, Number.isInteger(value) ? 0 : 2);
}

function readLastSite(): string | null {
  try {
    return window.localStorage.getItem(LAST_SITE_KEY);
  } catch {
    return null;
  }
}

function rememberSite(siteId: string) {
  try {
    window.localStorage.setItem(LAST_SITE_KEY, siteId);
  } catch {
    /* private mode / blocked storage — the picker just won't remember */
  }
}

export function OpsBoqApp({
  sites,
  selectedSiteId,
  rows,
  canEdit,
  todayIso,
}: {
  sites: SiteOption[];
  selectedSiteId: string | null;
  rows: OpsBoqRowView[];
  canEdit: boolean;
  todayIso: string;
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const selectedSite = sites.find((s) => s.id === selectedSiteId) ?? null;

  // "Remember the last selected site": with no ?site= in the URL, jump to the last one used (if it still exists).
  useEffect(() => {
    if (selectedSiteId) {
      rememberSite(selectedSiteId);
      return;
    }
    const last = readLastSite();
    if (last && sites.some((s) => s.id === last)) router.replace(`/operations-boq?site=${encodeURIComponent(last)}`);
  }, [selectedSiteId, sites, router]);

  function selectSite(siteId: string) {
    rememberSite(siteId);
    startNavigation(() => router.push(`/operations-boq?site=${encodeURIComponent(siteId)}`));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="ops-boq-site" className="text-sm font-medium">
          Select Site
        </label>
        <Select value={selectedSiteId ?? ""} onValueChange={(v) => v && selectSite(v)}>
          <SelectTrigger id="ops-boq-site" className="w-full sm:w-72" aria-label="Select Site">
            <SelectValue placeholder="Select a site…">
              {(value: string | null) => sites.find((s) => s.id === value)?.name ?? "Select a site…"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {navigating && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Loading site" />}
      </div>

      {sites.length === 0 && <EmptyState>There are no active sites yet. Create a site first (Dashboard → New site).</EmptyState>}
      {sites.length > 0 && !selectedSite && <EmptyState>Select a site to see its Operations BOQ.</EmptyState>}
      {selectedSite && rows.length === 0 && (
        <EmptyState>
          &quot;{selectedSite.name}&quot; has no Operations BOQ rows. It was created before this module existed, so its rows
          haven&apos;t been generated — ask an admin to run the Operations BOQ backfill for it.
        </EmptyState>
      )}
      {selectedSite && rows.length > 0 && (
        // key: switching site remounts the table so its local edit state can never leak across sites.
        <OpsBoqTable key={selectedSite.id} siteId={selectedSite.id} initialRows={rows} canEdit={canEdit} todayIso={todayIso} />
      )}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">{children}</div>
  );
}

function OpsBoqTable({
  siteId,
  initialRows,
  canEdit,
  todayIso,
}: {
  siteId: string;
  initialRows: OpsBoqRowView[];
  canEdit: boolean;
  todayIso: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [pendingDelete, setPendingDelete] = useState<OpsBoqRowView | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addPending, setAddPending] = useState(false);

  const totals = totalsOf(rows);
  const shared = sharedCount(rows);

  function patchRow(rowId: string, patch: Partial<OpsBoqRowView>) {
    setRows((current) => current.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  }

  /** Optimistic: show the new value now; on failure toast and put the previous value back. */
  async function saveCell(row: OpsBoqRowView, field: OpsBoqEditableField, raw: string) {
    const parsed = parseOpsBoqCell(field, raw);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    const previous = row[field];
    patchRow(row.id, { [field]: parsed.value } as Partial<OpsBoqRowView>);
    try {
      const result = await updateOpsBoqCell(row.id, field, parsed.value);
      if (result?.error) {
        patchRow(row.id, { [field]: previous } as Partial<OpsBoqRowView>);
        toast.error(result.error);
      }
    } catch {
      patchRow(row.id, { [field]: previous } as Partial<OpsBoqRowView>);
      toast.error("Could not save the change. Check your connection and try again.");
    }
  }

  async function saveName(row: OpsBoqRowView, raw: string) {
    const parsed = parseOpsBoqName(raw);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    const previous = row.name;
    patchRow(row.id, { name: parsed.value });
    try {
      const result = await renameOpsBoqRow(row.id, parsed.value);
      if (result?.error) {
        patchRow(row.id, { name: previous });
        toast.error(result.error);
      }
    } catch {
      patchRow(row.id, { name: previous });
      toast.error("Could not rename the row. Try again.");
    }
  }

  async function addRow() {
    const parsed = parseOpsBoqName(newName);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    setAddPending(true);
    try {
      const result = await addOpsBoqRow(siteId, parsed.value);
      if (result?.error || !result?.row) {
        toast.error(result?.error ?? "Could not add the row.");
      } else {
        const created = result.row;
        setRows((current) => [...current, created]);
        setNewName("");
        setAdding(false);
      }
    } catch {
      toast.error("Could not add the row. Try again.");
    } finally {
      setAddPending(false);
    }
  }

  async function confirmDelete(row: OpsBoqRowView) {
    const result = await deleteOpsBoqRow(row.id).catch(() => ({ error: "Could not delete the row. Try again." }));
    if (result?.error) {
      toast.error(result.error);
      return;
    }
    setRows((current) => current.filter((r) => r.id !== row.id));
    setPendingDelete(null);
  }

  const HEAD = "bg-card text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Total Amount" value={formatCurrency(totals.amount)} />
        <SummaryCard label="Advance Given" value={formatCurrency(totals.advanceGiven)} />
        <SummaryCard label="Pending" value={formatCurrency(totals.pending)} />
        <SummaryCard label="BOQs shared" value={`${shared.shared} / ${shared.total}`} />
      </div>

      {!canEdit && (
        <p className="text-xs text-muted-foreground">You can view this table but not edit it. Only Admin and Operations can make changes.</p>
      )}

      <div className="max-h-[70vh] overflow-auto rounded-xl bg-card ring-1 ring-foreground/10" data-testid="ops-boq-scroll">
        <table className="w-full caption-bottom text-sm" data-testid="ops-boq-table">
          <TableHeader className="sticky top-0 z-30">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(HEAD, "sticky left-0 z-40 w-14 min-w-14")}>S.No</TableHead>
              <TableHead className={cn(HEAD, "sticky left-14 z-40 w-56 min-w-56")}>Name</TableHead>
              <TableHead className={HEAD}>Vendor</TableHead>
              <TableHead className={HEAD}>BOQ Status</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>Amount</TableHead>
              <TableHead className={HEAD}>Link of BOQ</TableHead>
              <TableHead className={HEAD}>Link of Approved BOQ</TableHead>
              <TableHead className={HEAD}>Link of PO</TableHead>
              <TableHead className={HEAD}>Approved Via</TableHead>
              <TableHead className={HEAD}>Link</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>Advance Given</TableHead>
              <TableHead className={HEAD}>Stage</TableHead>
              <TableHead className={HEAD}>Follow Up</TableHead>
              <TableHead className={cn(HEAD, "text-right")}>Pending Amount</TableHead>
              <TableHead className={HEAD}>Remarks</TableHead>
              <TableHead className={cn(HEAD, "w-10")}>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const pending = pendingAmount(row.amount, row.advanceGiven);
              const overAdvanced = advanceExceedsAmount(row.amount, row.advanceGiven);
              const overdue = isFollowUpOverdue(row.followUpDate, pending, todayIso);
              return (
                <TableRow key={row.id} data-testid="ops-boq-row" data-row-name={row.name} data-fixed={row.isFixed}>
                  <TableCell className="sticky left-0 z-20 w-14 min-w-14 bg-card text-muted-foreground">{row.sno}</TableCell>
                  <TableCell className="sticky left-14 z-20 w-56 min-w-56 bg-card font-medium whitespace-normal">
                    {row.isFixed || !canEdit ? (
                      <span className="flex items-start gap-1.5 px-1.5" title={row.isFixed ? "Fixed row: name is locked" : undefined}>
                        <span>{row.name}</span>
                        {row.isFixed && canEdit && <LockIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />}
                      </span>
                    ) : (
                      <EditableCell
                        value={row.name}
                        display={row.name}
                        kind="text"
                        disabled={false}
                        ariaLabel={`Name of ${row.name}`}
                        widthClass="min-w-48"
                        onCommit={(next) => void saveName(row, next)}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <EditableCell
                      value={row.vendor ?? ""}
                      display={row.vendor ?? ""}
                      kind="text"
                      disabled={!canEdit}
                      ariaLabel={`Vendor for ${row.name}`}
                      onCommit={(next) => void saveCell(row, "vendor", next)}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={row.boqStatus}
                      disabled={!canEdit}
                      onValueChange={(v) => v && v !== row.boqStatus && void saveCell(row, "boqStatus", v)}
                    >
                      <SelectTrigger size="sm" aria-label={`BOQ Status for ${row.name}`} className="w-32">
                        <SelectValue>{(value: string | null) => (value === "SHARED" ? STATUS_LABELS.SHARED : STATUS_LABELS.NOT_SHARED)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NOT_SHARED">{STATUS_LABELS.NOT_SHARED}</SelectItem>
                        <SelectItem value="SHARED">{STATUS_LABELS.SHARED}</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <EditableCell
                      value={row.amount === null ? "" : String(row.amount)}
                      display={money(row.amount)}
                      kind="money"
                      disabled={!canEdit}
                      ariaLabel={`Amount for ${row.name}`}
                      widthClass="min-w-28"
                      onCommit={(next) => void saveCell(row, "amount", next)}
                    />
                  </TableCell>
                  <TableCell>
                    <LinkCell value={row.linkBoq ?? ""} disabled={!canEdit} ariaLabel={`Link of BOQ for ${row.name}`} onCommit={(next) => void saveCell(row, "linkBoq", next)} />
                  </TableCell>
                  <TableCell>
                    <LinkCell
                      value={row.linkApprovedBoq ?? ""}
                      disabled={!canEdit}
                      ariaLabel={`Link of Approved BOQ for ${row.name}`}
                      onCommit={(next) => void saveCell(row, "linkApprovedBoq", next)}
                    />
                  </TableCell>
                  <TableCell>
                    <LinkCell value={row.linkPo ?? ""} disabled={!canEdit} ariaLabel={`Link of PO for ${row.name}`} onCommit={(next) => void saveCell(row, "linkPo", next)} />
                  </TableCell>
                  <TableCell>
                    <EditableCell
                      value={row.approvedVia ?? ""}
                      display={row.approvedVia ?? ""}
                      kind="text"
                      disabled={!canEdit}
                      ariaLabel={`Approved Via for ${row.name}`}
                      widthClass="min-w-24"
                      onCommit={(next) => void saveCell(row, "approvedVia", next)}
                    />
                  </TableCell>
                  <TableCell>
                    <LinkCell value={row.link ?? ""} disabled={!canEdit} ariaLabel={`Link for ${row.name}`} onCommit={(next) => void saveCell(row, "link", next)} />
                  </TableCell>
                  <TableCell>
                    <EditableCell
                      value={row.advanceGiven === null ? "" : String(row.advanceGiven)}
                      display={money(row.advanceGiven)}
                      kind="money"
                      disabled={!canEdit}
                      ariaLabel={`Advance Given for ${row.name}`}
                      widthClass="min-w-28"
                      onCommit={(next) => void saveCell(row, "advanceGiven", next)}
                    />
                  </TableCell>
                  <TableCell>
                    <EditableCell
                      value={row.stage ?? ""}
                      display={row.stage ?? ""}
                      kind="text"
                      disabled={!canEdit}
                      ariaLabel={`Stage for ${row.name}`}
                      onCommit={(next) => void saveCell(row, "stage", next)}
                    />
                  </TableCell>
                  <TableCell>
                    <EditableCell
                      value={row.followUpDate ?? ""}
                      display={row.followUpDate ?? ""}
                      kind="date"
                      disabled={!canEdit}
                      ariaLabel={`Follow Up for ${row.name}`}
                      widthClass="min-w-36"
                      className={overdue ? "font-medium text-destructive" : undefined}
                      onCommit={(next) => void saveCell(row, "followUpDate", next)}
                    />
                    {overdue && (
                      <span className="block px-1.5 text-[10px] text-destructive" data-testid="ops-boq-overdue">
                        Overdue
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums" data-testid="ops-boq-pending">
                    <span className={cn("px-1.5", overAdvanced && "font-medium text-destructive")}>{pending === null ? "-" : formatCurrency(pending, Number.isInteger(pending) ? 0 : 2)}</span>
                    {overAdvanced && (
                      <span className="block px-1.5 text-[10px] text-destructive" data-testid="ops-boq-advance-warning">
                        Advance is more than Amount
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <EditableCell
                      value={row.remarks ?? ""}
                      display={row.remarks ?? ""}
                      kind="text"
                      disabled={!canEdit}
                      ariaLabel={`Remarks for ${row.name}`}
                      widthClass="min-w-48"
                      onCommit={(next) => void saveCell(row, "remarks", next)}
                    />
                  </TableCell>
                  <TableCell>
                    {canEdit && !row.isFixed && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${row.name}`}
                        onClick={() => setPendingDelete(row)}
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <tfoot className="sticky bottom-0 z-30" data-testid="ops-boq-total-row">
            <TableRow className="border-t bg-card font-semibold hover:bg-card">
              <TableCell className="sticky left-0 z-20 bg-card" />
              <TableCell className="sticky left-14 z-20 bg-card">Total</TableCell>
              <TableCell className="bg-card" />
              <TableCell className="bg-card" />
              <TableCell className="bg-card text-right tabular-nums" data-testid="ops-boq-total-amount">
                {formatCurrency(totals.amount)}
              </TableCell>
              <TableCell className="bg-card" />
              <TableCell className="bg-card" />
              <TableCell className="bg-card" />
              <TableCell className="bg-card" />
              <TableCell className="bg-card" />
              <TableCell className="bg-card text-right tabular-nums" data-testid="ops-boq-total-advance">
                {formatCurrency(totals.advanceGiven)}
              </TableCell>
              <TableCell className="bg-card" />
              <TableCell className="bg-card" />
              <TableCell className="bg-card text-right tabular-nums" data-testid="ops-boq-total-pending">
                {formatCurrency(totals.pending)}
              </TableCell>
              <TableCell className="bg-card" />
              <TableCell className="bg-card" />
            </TableRow>
          </tfoot>
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {adding ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addRow();
              }}
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={OPS_BOQ_NAME_MAX}
                placeholder="Item name, e.g. RO & GEYSER"
                aria-label="New item name"
                className="h-8 w-72 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <Button type="submit" size="sm" disabled={addPending}>
                {addPending ? "Adding…" : "Add"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setAdding(false);
                  setNewName("");
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon /> Add item
            </Button>
          )}
          <span className="text-xs text-muted-foreground">Added to this site only.</span>
        </div>
      )}

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &quot;{pendingDelete?.name}&quot;?</DialogTitle>
            <DialogDescription>This row and everything entered in it will be removed from this site. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" onClick={() => pendingDelete && void confirmDelete(pendingDelete)}>
              Delete row
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
