import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { LogoutButton } from "./logout-button";

export default async function MProjectListPage() {
  const user = await requireUser();

  // Only a SITE_SUPERVISOR has ProjectMember rows at all, but this is a real
  // gate, not just a UX nicety — see the matching guard on (app)/layout.tsx
  // for the reverse direction.
  if (user.role !== "SITE_SUPERVISOR") {
    redirect("/dashboard");
  }

  const memberships = await db.projectMember.findMany({
    where: { userId: user.id },
    select: { project: { select: { id: true, brand: true, location: true } } },
    orderBy: { createdAt: "asc" },
  });
  const projects = memberships.map((m) => m.project);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">{user.name}</h1>
          <p className="text-xs text-muted-foreground">Your projects</p>
        </div>
        <LogoutButton />
      </header>

      <main className="flex-1 divide-y">
        {projects.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            You haven&apos;t been assigned to any projects yet. Contact your admin.
          </p>
        ) : (
          projects.map((p) => (
            // Not a link yet — the destination screen (category → task
            // picker) is build order step 4, not this one.
            <div key={p.id} className="flex items-center gap-3 px-4 py-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {p.brand.slice(0, 1)}
              </div>
              <div>
                <p className="font-medium">
                  {p.brand} — {p.location}
                </p>
                <p className="text-xs text-muted-foreground">Tap to open (coming soon)</p>
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
