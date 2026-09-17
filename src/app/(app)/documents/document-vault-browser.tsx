"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DEPARTMENT_LABELS,
  DOCUMENT_STATUS_LABELS,
  formatDate,
  formatFileSize,
  formatProjectCode,
} from "@/lib/format";
import { DOCUMENT_STATUS_BADGE_CLASS } from "@/lib/badge-colors";
import type { Department, DocumentStatus } from "@prisma/client";

// Same fixed order as `getManageableModules` draws from — not filtered to
// "what I can manage" since this page is a read view across every
// department's documents on a project the user can see.
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

export type DocumentVaultRow = {
  id: string;
  category: Department;
  title: string;
  version: number;
  status: DocumentStatus;
  fileName: string;
  fileSize: number;
  createdAt: string; // ISO
  owner: { name: string };
  project: { id: string; seq: number; brand: string; location: string };
};

/**
 * Client-side filter only — Phase 1 document counts don't warrant a server
 * round-trip or real full-text search, and this keeps the page's data
 * fetching (role/project scoping, NFR-04 isolation) entirely server-side.
 */
function matchesQuery(document: DocumentVaultRow, query: string): boolean {
  const haystack = [
    document.title,
    document.fileName,
    document.project.brand,
    document.project.location,
    formatProjectCode(document.project.seq),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function DocumentVaultBrowser({ documents }: { documents: DocumentVaultRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => (query.trim() ? documents.filter((d) => matchesQuery(d, query.trim())) : documents),
    [documents, query]
  );

  const byCategory = useMemo(() => {
    const map = new Map<Department, DocumentVaultRow[]>();
    for (const document of filtered) {
      const bucket = map.get(document.category);
      if (bucket) {
        bucket.push(document);
      } else {
        map.set(document.category, [document]);
      }
    }
    return map;
  }, [filtered]);

  return (
    <div className="space-y-6">
      <Input
        type="search"
        placeholder="Search by title, file name, or project…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents match &quot;{query}&quot;.</p>
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
                      <Link
                        href={`/projects/${document.project.id}`}
                        className="text-sm underline underline-offset-4"
                      >
                        Open project →
                      </Link>
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
