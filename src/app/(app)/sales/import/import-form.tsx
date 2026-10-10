"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewSalesImport, confirmSalesImport, type SalesImportPreview } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPaiseAsRupees } from "@/lib/sales/format";

const STATUS_LABELS: Record<SalesImportPreview["sampleRows"][number]["status"], string> = {
  new: "New",
  changed: "Changed",
  unchanged: "Unchanged",
};

const STATUS_BADGE_CLASS: Record<SalesImportPreview["sampleRows"][number]["status"], string> = {
  new: "bg-emerald-500/10 text-emerald-600",
  changed: "bg-amber-500/10 text-amber-600",
  unchanged: "bg-slate-500/10 text-slate-600",
};

/**
 * Two-step dry-run-then-confirm flow (section 20A): nothing is written by
 * `previewSalesImport`. The chosen `File` is kept in component state and
 * resubmitted to `confirmSalesImport` on confirm — the preview result itself
 * is never trusted as what gets written; the confirm step re-parses the same
 * bytes from scratch.
 */
export function ImportForm({ projectId, returnPath }: { projectId: string; returnPath: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SalesImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<{ inserted: number; updated: number; rejected: number } | null>(
    null
  );
  const [isPreviewing, startPreview] = useTransition();
  const [isConfirming, startConfirm] = useTransition();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null;
    setFile(next);
    setPreview(null);
    setConfirmResult(null);
    setError(null);
  }

  function handlePreview() {
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    setError(null);
    setConfirmResult(null);
    startPreview(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await previewSalesImport(projectId, formData);
      if (!result.ok) {
        setError(result.error);
        setPreview(null);
        return;
      }
      setPreview(result.preview);
    });
  }

  function handleConfirm() {
    if (!file) return;
    setError(null);
    startConfirm(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await confirmSalesImport(projectId, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmResult(result);
      setPreview(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose a file</CardTitle>
          <p className="text-xs text-muted-foreground">
            Our own template layout: <code>date,gross_sales,net_sales,orders</code>. Dates as YYYY-MM-DD or
            DD/MM/YYYY, amounts in rupees. Up to 5MB / 5,000 rows.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sales-import-file">CSV file</Label>
            <Input id="sales-import-file" ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} />
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={handlePreview} disabled={!file || isPreviewing}>
              {isPreviewing ? "Checking…" : "Preview import"}
            </Button>
            <a href="/api/sales/template" className="text-sm underline underline-offset-4" download>
              Download template
            </a>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Review before confirming</CardTitle>
            <p className="text-xs text-muted-foreground">
              Nothing has been written yet. {preview.fileName} — {preview.rowsRead} data row(s) read.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <SummaryStat label="New" value={preview.newCount} />
              <SummaryStat label="Changed" value={preview.changedCount} />
              <SummaryStat label="Unchanged" value={preview.unchangedCount} />
              <SummaryStat label="Rejected" value={preview.rejectedCount} className={preview.rejectedCount > 0 ? "text-destructive" : undefined} />
              <SummaryStat
                label="Duplicate dates"
                value={preview.duplicateDatesCount}
                className={preview.duplicateDatesCount > 0 ? "text-amber-600" : undefined}
              />
            </div>

            {preview.duplicateDatesCount > 0 && (
              <p className="text-xs text-amber-600">
                {preview.duplicateDatesCount} date(s) appear more than once in this file — the last row for each date
                wins.
              </p>
            )}

            {preview.sampleRows.length > 0 && (
              <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Date</TableHead>
                      <TableHead>Gross</TableHead>
                      <TableHead>Net</TableHead>
                      <TableHead>Orders</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sampleRows.map((row) => (
                      <TableRow key={row.date}>
                        <TableCell className="text-xs">{row.date}</TableCell>
                        <TableCell className="text-xs">{formatPaiseAsRupees(row.grossSales)}</TableCell>
                        <TableCell className="text-xs">{formatPaiseAsRupees(row.netSales)}</TableCell>
                        <TableCell className="text-xs">{row.orders}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_BADGE_CLASS[row.status]}>
                            {STATUS_LABELS[row.status]}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {preview.rejectedRows.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-destructive">Rejected rows</p>
                <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Line</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rejectedRows.map((row) => (
                        <TableRow key={row.line}>
                          <TableCell className="text-xs">{row.line}</TableCell>
                          <TableCell className="text-xs text-destructive">{row.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <Button type="button" onClick={handleConfirm} disabled={isConfirming}>
              {isConfirming ? "Importing…" : "Confirm import"}
            </Button>
          </CardContent>
        </Card>
      )}

      {confirmResult && (
        <Card>
          <CardContent className="space-y-2 py-5 text-sm">
            <p className="font-medium text-emerald-600">Import confirmed.</p>
            <p className="text-muted-foreground">
              {confirmResult.inserted} new day(s), {confirmResult.updated} changed day(s), {confirmResult.rejected}{" "}
              row(s) rejected.
            </p>
            <a href={returnPath} className="text-sm underline underline-offset-4">
              Back to Sales →
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryStat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3 text-center">
      <div className={`text-xl font-semibold ${className ?? ""}`}>{value}</div>
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
    </div>
  );
}
