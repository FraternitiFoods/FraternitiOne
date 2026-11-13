"use client";

import { useActionState, useState } from "react";
import { createOnboarding } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PersonOption = { id: string; name: string; email: string | null };

export function NewOnboardingForm({
  salesOwners,
  existingFranchisees,
  defaultSalesOwnerId,
}: {
  salesOwners: PersonOption[];
  existingFranchisees: PersonOption[];
  defaultSalesOwnerId?: string;
}) {
  const [state, action, pending] = useActionState(createOnboarding, undefined);
  const [entityType, setEntityType] = useState("INDIVIDUAL");
  const [accountMode, setAccountMode] = useState<"new" | "existing">("new");

  const salesOwnerLabels = Object.fromEntries(
    salesOwners.map((u) => [u.id, `${u.name} (${u.email ?? "no email"})`])
  );
  const existingFranchiseeLabels = Object.fromEntries(
    existingFranchisees.map((u) => [u.id, `${u.name} (${u.email ?? "no email"})`])
  );

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="brand">Brand</Label>
          <Input id="brand" name="brand" defaultValue="Tulsi" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="format">Format</Label>
          <Input id="format" name="format" placeholder="e.g. Dine-in, QSR, Kiosk" required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="proposedLocation">Proposed location</Label>
        <Input id="proposedLocation" name="proposedLocation" placeholder="City / site address" required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="legalApplicantName">Legal applicant name</Label>
          <Input id="legalApplicantName" name="legalApplicantName" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="entityType">Entity type</Label>
          <Select
            name="entityType"
            value={entityType}
            onValueChange={(value) => setEntityType(value ?? "INDIVIDUAL")}
            required
          >
            <SelectTrigger id="entityType" className="w-full">
              <SelectValue placeholder="Select entity type">
                {(value: string | null) =>
                  value === "COMPANY" ? "Company" : "Individual"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="INDIVIDUAL">Individual</SelectItem>
              <SelectItem value="COMPANY">Company</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contactPhone">Contact phone</Label>
        <Input id="contactPhone" name="contactPhone" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="accountMode">Franchisee account</Label>
        <Select
          name="accountMode"
          value={accountMode}
          onValueChange={(value) => setAccountMode(value === "existing" ? "existing" : "new")}
          required
        >
          <SelectTrigger id="accountMode" className="w-full">
            <SelectValue placeholder="Select account type">
              {(value: string | null) =>
                value === "existing" ? "Use existing account" : "Create new account"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">Create new account</SelectItem>
            <SelectItem value="existing">Use existing account</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {accountMode === "existing"
            ? "Attaches a franchisee login that already exists but isn't linked to any store yet — no new account, no second invite."
            : "Mints a brand-new franchisee login for this store and emails an invite to set it up."}
        </p>
      </div>

      {accountMode === "new" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="franchiseeName">Franchisee name</Label>
            <Input id="franchiseeName" name="franchiseeName" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspaceEmail">Workspace email</Label>
            <Input
              id="workspaceEmail"
              name="workspaceEmail"
              type="email"
              placeholder="franchisee@tulsi-store.example"
              required
            />
            <p className="text-xs text-muted-foreground">
              Canonical login for this franchisee — one Workspace email per store (P1-01).
            </p>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="existingUserId">Existing franchisee account</Label>
          {existingFranchisees.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No unlinked franchisee accounts available — create one from Users first, or use
              &quot;Create new account&quot; above.
            </p>
          ) : (
            <Select name="existingUserId" required>
              <SelectTrigger id="existingUserId" className="w-full">
                <SelectValue placeholder="Select existing account">
                  {(value: string | null) =>
                    value ? existingFranchiseeLabels[value] : "Select existing account"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {existingFranchisees.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.email ?? "no email"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">
            That account&apos;s own name and email become this store&apos;s franchisee name and
            Workspace email — one franchisee user still maps to exactly one store (P1-01).
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="salesOwnerId">Sales owner</Label>
          <Select name="salesOwnerId" defaultValue={defaultSalesOwnerId} required>
            <SelectTrigger id="salesOwnerId" className="w-full">
              <SelectValue placeholder="Select sales owner">
                {(value: string | null) => (value ? salesOwnerLabels[value] : "Select sales owner")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {salesOwners.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name} ({u.email ?? "no email"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="expectedAmountRupees">LOI fee amount (₹)</Label>
          <Input
            id="expectedAmountRupees"
            name="expectedAmountRupees"
            type="number"
            min="1"
            step="1"
            required
          />
        </div>
      </div>

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create Onboarding"}
      </Button>
    </form>
  );
}
