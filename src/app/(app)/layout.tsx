import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { logout } from "@/app/(auth)/login/actions";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Every route under this layout requires an authenticated user — this is
  // the real (database-backed) check; src/proxy.ts only does an optimistic
  // cookie-presence check before the request even gets here.
  const user = await requireUser();

  // A SITE_SUPERVISOR's whole world is /m (plan.md section 16) — none of the
  // desktop role→department permission checks (permissions.ts) account for
  // ProjectMember-scoped access, so letting a supervisor session render any
  // page under this layout would be a real project-isolation gap, not just a
  // wrong-UI one. Bounce them before any such page can render.
  if (user.role === "SITE_SUPERVISOR") {
    redirect("/m");
  }

  // plan.md section 17 — same backstop reasoning as SITE_SUPERVISOR above:
  // login() already redirects a FRANCHISEE with a non-complete onboarding to
  // /onboarding, but a stale bookmark/back-button hitting e.g. /projects
  // directly must not render the normal desktop app for them either — their
  // onboarding record isn't a FranchiseProject yet, so canViewProject/every
  // other page has nothing valid to show them.
  //
  // `onboardingStatus` is folded into requireUser()'s own query (see
  // session.ts) so this check doesn't cost a second DB round trip on every
  // navigation under this layout.
  if (user.role === "FRANCHISEE" && user.onboardingStatus && user.onboardingStatus !== "LOI_COMPLETE") {
    redirect("/onboarding");
  }

  // Drives the sidebar's BOQ/Operations filter (app-sidebar.tsx) — folded
  // into requireUser()'s own session query (session.ts) so this doesn't
  // cost a second DB round trip on every navigation.
  const isLegacyFranchisee = user.role === "FRANCHISEE" && user.isLegacyFranchisee === true;

  return (
    <div className="min-h-screen bg-muted/30">
      <AppSidebar name={user.name} role={user.role} isLegacyFranchisee={isLegacyFranchisee} />
      <form action={logout} className="fixed top-3 right-4 z-50 hidden sm:block">
        <Button type="submit" variant="outline" size="sm" className="h-7 px-2 text-xs">
          Sign out
        </Button>
      </form>
      <main className="min-h-screen px-4 py-4 sm:py-8 sm:pr-8 sm:pl-[15rem]">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
