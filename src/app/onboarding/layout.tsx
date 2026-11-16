import { redirect } from "next/navigation";
import { Fraunces, Figtree } from "next/font/google";
import { requireUser } from "@/lib/auth";
import { OnboardingSidebar } from "@/components/onboarding-sidebar";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { ChatShell } from "@/components/onboarding-chat/chat-shell";

// Loaded here (not in the root layout) so only /onboarding/* preloads them;
// the staff app keeps Montserrat. Variables are consumed by `.ob-theme` in globals.css.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  fallback: ["Georgia", "serif"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  fallback: ["system-ui", "sans-serif"],
});

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
    <div className={`ob-theme ${fraunces.variable} ${figtree.variable} min-h-screen`}>
      <OnboardingSidebar
        name={user.name}
        code={user.onboardingSeq != null ? formatOnboardingCode(user.onboardingSeq) : null}
      />
      <ChatShell>{children}</ChatShell>
    </div>
  );
}
