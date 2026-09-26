import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canCreateOnboarding } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewOnboardingForm } from "./new-onboarding-form";

export default async function NewStoreOnboardingPage() {
  const user = await requireUser();

  if (!canCreateOnboarding(user)) {
    redirect("/store-onboarding");
  }

  const salesOwners = await db.user.findMany({
    where: { role: { in: ["SALES", "ADMIN"] }, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Store Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Reserves a Project ID and creates the franchisee&apos;s account (plan.md section 17,
          P1-01). No FranchiseProject is created yet — that happens only at LOI Complete.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Store &amp; applicant details</CardTitle>
        </CardHeader>
        <CardContent>
          <NewOnboardingForm
            salesOwners={salesOwners}
            defaultSalesOwnerId={user.role === "SALES" ? user.id : undefined}
          />
        </CardContent>
      </Card>
    </div>
  );
}
