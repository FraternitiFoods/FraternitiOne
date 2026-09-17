"use client";

import { useActionState } from "react";
import { createDocument, type ActionState } from "./document-actions";
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
import { DEPARTMENT_LABELS } from "@/lib/format";
import type { Department } from "@prisma/client";

export function DocumentUploadForm({
  projectId,
  categories,
}: {
  projectId: string;
  categories: Department[];
}) {
  const boundAction = createDocument.bind(null, projectId);
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select name="category" required>
            <SelectTrigger id="category" className="w-full">
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
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" required placeholder="e.g. Signed Lease Deed" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="file">File</Label>
        <Input id="file" name="file" type="file" required />
        <p className="text-xs text-muted-foreground">
          PDF, Word, Excel, PowerPoint, or an image — up to 15MB.
        </p>
      </div>

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Uploading…" : "Upload Document"}
      </Button>
    </form>
  );
}
