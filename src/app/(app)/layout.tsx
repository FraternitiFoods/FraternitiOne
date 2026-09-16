import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/format";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Every route under this layout requires an authenticated user — this is
  // the real (database-backed) check; src/proxy.ts only does an optimistic
  // cookie-presence check before the request even gets here.
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold">
              Fraterniti One
            </Link>
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/projects" className="text-sm text-muted-foreground hover:text-foreground">
              Projects
            </Link>
            <Link href="/audit" className="text-sm text-muted-foreground hover:text-foreground">
              Audit Log
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium">{user.name}</div>
              <Badge variant="secondary" className="text-xs">
                {ROLE_LABELS[user.role]}
              </Badge>
            </div>
            <form action={logout}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
