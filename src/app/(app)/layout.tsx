import { requireUser } from "@/lib/auth";
import { logout } from "@/app/(auth)/login/actions";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Every route under this layout requires an authenticated user — this is
  // the real (database-backed) check; src/proxy.ts only does an optimistic
  // cookie-presence check before the request even gets here.
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-muted/30">
      <AppSidebar name={user.name} role={user.role} />
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
