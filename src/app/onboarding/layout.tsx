import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { OnboardingSidebar } from "@/components/onboarding-sidebar";

/**
 * plan.md section 17 — franchisee-only portal. Structurally satisfies P1-03
 * (a franchisee reaches only their own onboarding): every page under here
 * resolves "my onboarding" via `franchiseeUserId: user.id` from the session,
 * never from a URL param, so there is no id to guess or tamper with.
 */
export default async function OnboardingLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  if (user.role !== "FRANCHISEE") {
    redirect("/dashboard");
  }

  const onboarding = await db.storeOnboarding.findUnique({
    where: { franchiseeUserId: user.id },
    select: { onboardingStatus: true },
  });

  // No onboarding record at all (existing seeded/real franchisees) — keep
  // today's behaviour exactly, per section 17's non-negotiable.
  if (!onboarding) {
    redirect("/dashboard");
  }
  // Already converted — the normal project pages take over from here.
  if (onboarding.onboardingStatus === "LOI_COMPLETE") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <OnboardingSidebar name={user.name} />
      <main className="min-h-screen px-4 py-4 sm:py-8 sm:pr-8 sm:pl-[15rem]">
        <div className="mx-auto max-w-4xl">{children}</div>
      </main>
    </div>
  );
}
