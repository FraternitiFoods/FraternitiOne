"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LoiVersionStatus, OnboardingStatus, ReviewStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterSelect, FILTER_ALL } from "@/components/filter-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ONBOARDING_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  LOI_VERSION_STATUS_LABELS,
  formatMoney,
} from "@/lib/onboarding/format";
import { LOI_NOT_GENERATED } from "@/lib/onboarding/search-constants";
import { DeleteOnboardingButton } from "./delete-onboarding-button";

type OnboardingRow = {
  id: string;
  seq: number;
  code: string;
  brand: string;
  proposedLocation: string;
  onboardingStatus: OnboardingStatus;
  kycStatus: ReviewStatus;
  paymentStatus: ReviewStatus;
  loiStatus: LoiVersionStatus | null;
  expectedAmount: number;
  projectId: string | null;
  franchisee: { name: string; email: string | null };
  salesOwner: { name: string };
};

const ONBOARDING_STATUS_OPTIONS = Object.entries(ONBOARDING_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const REVIEW_STATUS_OPTIONS = Object.entries(REVIEW_STATUS_LABELS).map(([value, label]) => ({ value, label }));
const LOI_STATUS_OPTIONS = [
  { value: LOI_NOT_GENERATED, label: "Not Generated" },
  ...Object.entries(LOI_VERSION_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

/**
 * plan.md section 20D: search box over franchisee name, phone, workspace
 * email, brand, location, store code and sales person, plus onboarding/KYC/
 * payment/LOI status filters. Client-side filter over the already role-scoped
 * rows — same shape as ComplaintList/DocumentVaultBrowser (no PAN column:
 * it's encrypted, never sent to the client at all).
 */
export function StoreOnboardingList({
  onboardings,
  canDelete,
}: {
  onboardings: OnboardingRow[];
  canDelete: boolean;
}) {
  const [search, setSearch] = useState("");
  const [onboardingStatusFilter, setOnboardingStatusFilter] = useState(FILTER_ALL);
  const [kycStatusFilter, setKycStatusFilter] = useState(FILTER_ALL);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState(FILTER_ALL);
  const [loiStatusFilter, setLoiStatusFilter] = useState(FILTER_ALL);

  const hasActiveFilters =
    onboardingStatusFilter !== FILTER_ALL ||
    kycStatusFilter !== FILTER_ALL ||
    paymentStatusFilter !== FILTER_ALL ||
    loiStatusFilter !== FILTER_ALL;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return onboardings.filter((o) => {
      if (onboardingStatusFilter !== FILTER_ALL && o.onboardingStatus !== onboardingStatusFilter) return false;
      if (kycStatusFilter !== FILTER_ALL && o.kycStatus !== kycStatusFilter) return false;
      if (paymentStatusFilter !== FILTER_ALL && o.paymentStatus !== paymentStatusFilter) return false;
      if (loiStatusFilter !== FILTER_ALL) {
        const rowLoiStatus = o.loiStatus ?? LOI_NOT_GENERATED;
        if (rowLoiStatus !== loiStatusFilter) return false;
      }
      if (!q) return true;
      const haystack = [o.code, o.brand, o.proposedLocation, o.franchisee.name, o.franchisee.email, o.salesOwner.name]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [search, onboardingStatusFilter, kycStatusFilter, paymentStatusFilter, loiStatusFilter, onboardings]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (onboardingStatusFilter !== FILTER_ALL) params.set("onboardingStatus", onboardingStatusFilter);
    if (kycStatusFilter !== FILTER_ALL) params.set("kycStatus", kycStatusFilter);
    if (paymentStatusFilter !== FILTER_ALL) params.set("paymentStatus", paymentStatusFilter);
    if (loiStatusFilter !== FILTER_ALL) params.set("loiStatus", loiStatusFilter);
    const qs = params.toString();
    return `/api/store-onboarding/export${qs ? `?${qs}` : ""}`;
  }, [search, onboardingStatusFilter, kycStatusFilter, paymentStatusFilter, loiStatusFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, email, brand, location, store code, sales person…"
          className="max-w-sm"
        />
        <FilterSelect
          value={onboardingStatusFilter}
          onChange={setOnboardingStatusFilter}
          options={ONBOARDING_STATUS_OPTIONS}
          allLabel="All onboarding statuses"
          className="h-9 w-full sm:w-[190px]"
        />
        <FilterSelect
          value={kycStatusFilter}
          onChange={setKycStatusFilter}
          options={REVIEW_STATUS_OPTIONS}
          allLabel="All KYC statuses"
          className="h-9 w-full sm:w-[170px]"
        />
        <FilterSelect
          value={paymentStatusFilter}
          onChange={setPaymentStatusFilter}
          options={REVIEW_STATUS_OPTIONS}
          allLabel="All payment statuses"
          className="h-9 w-full sm:w-[170px]"
        />
        <FilterSelect
          value={loiStatusFilter}
          onChange={setLoiStatusFilter}
          options={LOI_STATUS_OPTIONS}
          allLabel="All LOI statuses"
          className="h-9 w-full sm:w-[170px]"
        />
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOnboardingStatusFilter(FILTER_ALL);
              setKycStatusFilter(FILTER_ALL);
              setPaymentStatusFilter(FILTER_ALL);
              setLoiStatusFilter(FILTER_ALL);
            }}
          >
            Clear filters
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          nativeButton={false}
          render={<a href={exportHref}>Export CSV</a>}
        />
      </div>

      {onboardings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No store onboardings yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No onboardings match your search and filters.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {onboardings.length} onboarding{onboardings.length === 1 ? "" : "s"}
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store</TableHead>
                  <TableHead>Franchisee</TableHead>
                  <TableHead>Sales Person</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>KYC</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>LOI</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>Project</TableHead>
                  {canDelete && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link href={`/store-onboarding/${o.id}`} className="font-medium hover:underline">
                        {o.code} — {o.brand} {o.proposedLocation}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div>{o.franchisee.name}</div>
                      <div className="text-xs text-muted-foreground">{o.franchisee.email}</div>
                    </TableCell>
                    <TableCell>{o.salesOwner.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{ONBOARDING_STATUS_LABELS[o.onboardingStatus]}</Badge>
                    </TableCell>
                    <TableCell>{REVIEW_STATUS_LABELS[o.kycStatus]}</TableCell>
                    <TableCell>{REVIEW_STATUS_LABELS[o.paymentStatus]}</TableCell>
                    <TableCell>{o.loiStatus ? LOI_VERSION_STATUS_LABELS[o.loiStatus] : "Not Generated"}</TableCell>
                    <TableCell>{formatMoney(o.expectedAmount)}</TableCell>
                    <TableCell>
                      {o.projectId ? (
                        <Link href={`/projects/${o.projectId}`} className="underline underline-offset-4">
                          View →
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {canDelete && (
                      <TableCell>
                        <DeleteOnboardingButton
                          onboardingId={o.id}
                          storeLabel={`${o.code} — ${o.brand} ${o.proposedLocation}`}
                          franchiseeEmail={o.franchisee.email}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
