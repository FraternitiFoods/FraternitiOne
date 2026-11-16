import { redirect } from "next/navigation";
import { requireOnboardingUser } from "@/lib/onboarding-access";
import { db } from "@/lib/db";
import { canCreateOnboarding } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewOnboardingForm } from "./new-onboarding-form";

export default async function NewStoreOnboardingPage() {
  const user = await requireOnboardingUser();

  if (!canCreateOnboarding(user)) {
    redirect("/store-onboarding");
  }

  const [salesOwners, existingFranchisees] = await Promise.all([
    db.user.findMany({
      where: { role: { in: ["SALES", "ADMIN"] }, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    // FRANCHISEE-role accounts that exist (e.g. provisioned ahead of time via
    // /users/new) but aren't yet linked to a store — eligible to attach here
    // instead of minting a second account for the same person (P1-01 still
    // holds: `onboardingAsFranchisee: { is: null }` is exactly "not already
    // some other store's franchisee").
    db.user.findMany({
      where: { role: "FRANCHISEE", isActive: true, onboardingAsFranchisee: { is: null } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Store Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Creates the franchisee&apos;s account and onboarding record. The store&apos;s Dashboard site
          (with its Tracker, BOQ and Operations BOQ) is created only when the LOI is fully signed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Store &amp; applicant details</CardTitle>
        </CardHeader>
        <CardContent>
          <NewOnboardingForm
            salesOwners={salesOwners}
            existingFranchisees={existingFranchisees}
            defaultSalesOwnerId={user.role === "SALES" ? user.id : undefined}
          />
        </CardContent>
      </Card>
    </div>
  );
}
