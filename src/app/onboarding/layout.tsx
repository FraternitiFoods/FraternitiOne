import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
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

  // `onboardingStatus` is folded into requireUser()'s own query (see
  // session.ts) so this check doesn't cost a second DB round trip on every
  // navigation under this layout — same reasoning as the (app) layout.
  //
  // `null` covers both "no onboarding record at all" (existing
  // seeded/real franchisees — keep today's behaviour exactly, per section
  // 17's non-negotiable) and "already converted" is covered by the
  // LOI_COMPLETE check below; both send the franchisee to /dashboard.
  if (!user.onboardingStatus || user.onboardingStatus === "LOI_COMPLETE") {
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
