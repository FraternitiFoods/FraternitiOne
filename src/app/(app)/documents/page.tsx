import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import {
  DEPARTMENT_LABELS,
  DOCUMENT_STATUS_LABELS,
  formatDate,
  formatFileSize,
  formatProjectCode,
} from "@/lib/format";
import { DOCUMENT_STATUS_BADGE_CLASS } from "@/lib/badge-colors";
import type { Department, Prisma } from "@prisma/client";

// Fixed display order for category sections — same list `getManageableModules`
// draws from, just not filtered to "what I can manage" since this page is a
// read view across every department's documents on a project the user can see.
const CATEGORY_ORDER: Department[] = [
  "SALES",
  "LEGAL",
  "PROPERTY",
  "INTERIORS",
  "PROJECTS",
  "ACCOUNTS",
  "HR",
  "CULINARY",
  "PROCUREMENT",
  "MARKETING",
  "OPERATIONS",
  "FRANCHISEE",
  "GENERAL",
];

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

  const [documents, project] = await Promise.all([
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
  ]);

  const byCategory = new Map<Department, typeof documents>();
  for (const document of documents) {
    const bucket = byCategory.get(document.category);
    if (bucket) {
      bucket.push(document);
    } else {
      byCategory.set(document.category, [document]);
    }
  }

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
      />

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents yet.</p>
      ) : (
        <div className="space-y-6">
          {CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="text-base">{DEPARTMENT_LABELS[category]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {byCategory.get(category)!.map((document) => (
                  <div
                    key={document.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-card p-3 ring-1 ring-foreground/10"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{document.title}</span>
                        <Badge variant="outline">v{document.version}</Badge>
                        {document.status === "APPROVED" && (
                          <Badge
                            variant="outline"
                            className="border-transparent bg-emerald-100 text-emerald-700"
                          >
                            Latest approved
                          </Badge>
                        )}
                      </div>
                      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {formatProjectCode(document.project.seq)} — {document.project.brand},{" "}
                          {document.project.location}
                        </span>
                        <span>{document.fileName}</span>
                        <span>{formatFileSize(document.fileSize)}</span>
                        <span>Uploaded by {document.owner.name}</span>
                        <span>{formatDate(document.createdAt)}</span>
                      </dl>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge
                        variant="outline"
                        className={DOCUMENT_STATUS_BADGE_CLASS[document.status]}
                      >
                        {DOCUMENT_STATUS_LABELS[document.status]}
                      </Badge>
                      <a
                        href={`/projects/${document.project.id}/documents/${document.id}/download`}
                        className="text-sm underline underline-offset-4"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
