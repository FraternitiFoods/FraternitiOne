"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DocumentCard, type DocumentCardData } from "./document-card";

const PAGE_SIZE = 10;

/**
 * Same search/"load 10 more" shape as TaskList/ComplaintList — a project's
 * documents were the one list on this page with no cap, so every
 * DocumentCard (two server-action forms + a Select each) mounted at once
 * regardless of count, which is exactly the kind of unbounded client work
 * that makes scrolling to this section slow on mobile.
 */
export function DocumentList({
  documents,
  projectId,
}: {
  documents: (DocumentCardData & { canAct: boolean })[];
  projectId: string;
}) {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function handleSearchChange(value: string) {
    setSearch(value);
    setVisibleCount(PAGE_SIZE);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => {
      const haystack = [d.title, d.fileName, d.category, d.owner.name].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [search, documents]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visible.length;

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder="Search documents by title, file name, category, uploader…"
        className="max-w-sm"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {documents.length === 0 ? "No documents yet." : "No documents match your search."}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {visible.length} of {filtered.length} document{filtered.length === 1 ? "" : "s"}
          </p>
          <div className="space-y-3">
            {visible.map((document) => (
              <DocumentCard
                key={document.id}
                projectId={projectId}
                canAct={document.canAct}
                document={document}
              />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                Load 10 more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
