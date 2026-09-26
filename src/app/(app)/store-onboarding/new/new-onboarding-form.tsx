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
  defaultSalesOwnerId,
}: {
  salesOwners: PersonOption[];
  defaultSalesOwnerId?: string;
}) {
  const [state, action, pending] = useActionState(createOnboarding, undefined);
  const [entityType, setEntityType] = useState("INDIVIDUAL");

  const salesOwnerLabels = Object.fromEntries(
    salesOwners.map((u) => [u.id, `${u.name} (${u.email ?? "no email"})`])
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="franchiseeName">Franchisee name</Label>
          <Input id="franchiseeName" name="franchiseeName" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactPhone">Contact phone</Label>
          <Input id="contactPhone" name="contactPhone" required />
        </div>
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
