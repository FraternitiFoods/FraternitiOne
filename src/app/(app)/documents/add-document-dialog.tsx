"use client";

import { useActionState, useState } from "react";
import { createVaultDocument } from "../projects/[id]/document-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DEPARTMENT_LABELS, formatProjectCode } from "@/lib/format";
import type { Department } from "@prisma/client";

type ProjectOption = { id: string; seq: number; brand: string; location: string };

function projectLabel(project: ProjectOption): string {
  return `${formatProjectCode(project.seq)} — ${project.brand}, ${project.location}`;
}

export function AddDocumentDialog({
  projects,
  categories,
  defaultProjectId,
}: {
  projects: ProjectOption[];
  categories: Department[];
  defaultProjectId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createVaultDocument, undefined);

  // The action redirects back to this same page on success, so unlike a
  // form that navigates elsewhere, we have to close the popup ourselves.
  // Adjusted during render (not an effect) per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // — it closes the moment a submission finishes without an error.
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (wasPending && !pending && !state?.error) {
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Add new document</Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add new document</DialogTitle>
          <DialogDescription>Upload a document to any project you can manage (FR-005).</DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vault-projectId">Project</Label>
            <Select name="projectId" required defaultValue={defaultProjectId}>
              <SelectTrigger id="vault-projectId" className="w-full">
                <SelectValue placeholder="Select project">
                  {(value: string | null) => {
                    const project = projects.find((p) => p.id === value);
                    return project ? projectLabel(project) : "Select project";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {projectLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vault-category">Category</Label>
              <Select name="category" required>
                <SelectTrigger id="vault-category" className="w-full">
                  <SelectValue placeholder="Select category">
                    {(value: Department | null) => (value ? DEPARTMENT_LABELS[value] : "Select category")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {DEPARTMENT_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vault-title">Title</Label>
              <Input id="vault-title" name="title" required placeholder="e.g. Signed Lease Deed" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vault-file">File</Label>
            <Input id="vault-file" name="file" type="file" required />
            <p className="text-xs text-muted-foreground">
              PDF, Word, Excel, PowerPoint, or an image — up to 15MB.
            </p>
          </div>

          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Uploading…" : "Upload Document"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
