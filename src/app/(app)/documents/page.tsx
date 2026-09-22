import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getManageableModules } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { formatProjectCode } from "@/lib/format";
import type { Prisma } from "@prisma/client";
import { DocumentVaultBrowser, type DocumentVaultRow } from "./document-vault-browser";
import { AddDocumentDialog } from "./add-document-dialog";

export default async function DocumentsPage(props: PageProps<"/documents">) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const projectParam = searchParams.project;
  const projectId = typeof projectParam === "string" ? projectParam : undefined;

  // Same isolation rule as project visibility (NFR-04): a franchisee only
  // ever sees documents on their own project(s); every internal role sees
  // the full vault so they can find any department's latest paperwork.
  // `supersededBy: null` is the whole point of the version chain (FR-005:
  // "Latest approved version clearly identified") — a superseded version
  // always has a `supersededBy` pointing at what replaced it, so filtering
  // it out here means each lineage shows up exactly once, as its current
  // head, without walking the chain by hand.
  const where: Prisma.DocumentWhereInput = {
    supersededBy: null,
    ...(user.role === "FRANCHISEE"
      ? { project: { franchiseeId: user.id }, ...(projectId ? { projectId } : {}) }
      : projectId
        ? { projectId }
        : {}),
  };

  const categories = getManageableModules(user);

  const [documents, project, uploadableProjects] = await Promise.all([
    db.document.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        project: { select: { id: true, seq: true, brand: true, location: true } },
      },
      orderBy: [{ category: "asc" }, { createdAt: "desc" }],
    }),
    projectId
      ? db.franchiseProject.findUnique({
          where: { id: projectId },
          select: { seq: true, brand: true, location: true },
        })
      : Promise.resolve(null),
    categories.length > 0
      ? db.franchiseProject.findMany({
          where: user.role === "FRANCHISEE" ? { franchiseeId: user.id } : undefined,
          select: { id: true, seq: true, brand: true, location: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  // Grouping/search live in the client component; the server side only owns
  // the authorization-sensitive query and hands over plain, serializable rows.
  const rows: DocumentVaultRow[] = documents.map((document) => ({
    id: document.id,
    category: document.category,
    title: document.title,
    version: document.version,
    status: document.status,
    fileName: document.fileName,
    fileSize: document.fileSize,
    createdAt: document.createdAt.toISOString(),
    owner: document.owner,
    project: document.project,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document Vault"
        subtitle={
          project ? (
            <>
              Scoped to {formatProjectCode(project.seq)} — {project.brand}, {project.location}.{" "}
              <Link href="/documents" className="underline underline-offset-4">
                View full vault
              </Link>
            </>
          ) : (
            "Every current document version, by department (FR-005)."
          )
        }
        isFranchisee={user.role === "FRANCHISEE"}
        action={
          categories.length > 0 ? (
            <AddDocumentDialog
              projects={uploadableProjects}
              categories={categories}
              defaultProjectId={projectId}
            />
          ) : undefined
        }
      />

      <DocumentVaultBrowser documents={rows} />
    </div>
  );
}
