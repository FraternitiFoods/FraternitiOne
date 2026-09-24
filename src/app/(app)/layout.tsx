import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";

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

  return (
    <div className="min-h-screen bg-muted/30">
      <AppSidebar name={user.name} role={user.role} />
      <main className="min-h-screen py-8 pr-8 pl-[15rem]">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
