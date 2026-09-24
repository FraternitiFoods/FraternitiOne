import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { categoryHasBoqTasks } from "@/lib/ops-route";
import { formatFileSize, formatDateTime } from "@/lib/format";
import { UploadFlow } from "./upload-flow";

export default async function MProjectChatPage(props: PageProps<"/m/[id]">) {
  const { id: projectId } = await props.params;
  const user = await requireUser();

  if (user.role !== "SITE_SUPERVISOR") {
    notFound();
  }

  // The real access gate: a supervisor only ever sees a project they have a
  // ProjectMember row for — guessing a project id in the URL gets the same
  // 404 as a project that doesn't exist at all (plan.md section 16's "cause
  // -> effect that must hold").
  const membership = await db.projectMember.findUnique({
    where: { userId_projectId: { userId: user.id, projectId } },
    select: {
      project: { select: { id: true, brand: true, location: true } },
    },
  });
  if (!membership) {
    notFound();
  }
  const project = membership.project;

  const categoryRows = await db.task.findMany({
    where: { projectId, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
  });
  const categories = categoryRows
    .map((r) => r.category)
    .filter((c): c is string => c !== null && categoryHasBoqTasks(c))
    .sort();

  const recentUploads = await db.document.findMany({
    where: { projectId, ownerId: user.id },
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      createdAt: true,
      task: { select: { title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card px-4 py-3">
        <Link href="/m" className="text-sm text-muted-foreground hover:text-foreground">
          ←
        </Link>
        <div>
          <h1 className="text-base font-semibold">
            {project.brand} — {project.location}
          </h1>
          <p className="text-xs text-muted-foreground">{categories.length} categories</p>
        </div>
      </header>

      <main className="flex-1 space-y-2 overflow-y-auto p-4">
        {recentUploads.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            No uploads yet. Tap &quot;Send photo/video&quot; below to get started.
          </p>
        ) : (
          [...recentUploads].reverse().map((doc) => (
            <div key={doc.id} className="ml-auto max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm">
              <p className="font-medium">{doc.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {doc.task?.title ?? "Unknown task"} · {formatFileSize(doc.fileSize)}
              </p>
              <p className="text-right text-[10px] text-muted-foreground">
                {formatDateTime(doc.createdAt)}
              </p>
            </div>
          ))
        )}
      </main>

      <div className="sticky bottom-0 border-t bg-card p-4">
        <UploadFlow projectId={projectId} categories={categories} />
      </div>
    </div>
  );
}
