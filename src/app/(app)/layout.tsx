import { requireUser } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Every route under this layout requires an authenticated user — this is
  // the real (database-backed) check; src/proxy.ts only does an optimistic
  // cookie-presence check before the request even gets here.
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-muted/30">
      <AppSidebar name={user.name} role={user.role} />
      <main className="min-h-screen py-8 pr-8 pl-[15rem]">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
