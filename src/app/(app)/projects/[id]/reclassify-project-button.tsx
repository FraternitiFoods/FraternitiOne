"use client";

import { useState } from "react";
import { useActionState } from "react";
import { reclassifyProject, type ReclassifyProjectState } from "../actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

export function ReclassifyProjectButton({
  projectId,
  isPreExisting,
  taskCount,
}: {
  projectId: string;
  isPreExisting: boolean;
  taskCount: number;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = reclassifyProject.bind(null, projectId);
  const [state, action, pending] = useActionState<ReclassifyProjectState, FormData>(boundAction, undefined);

  const label = isPreExisting ? "Mark as build-out project" : "Mark as already operational";
  const description = isPreExisting
    ? taskCount === 0
      ? "This marks the project as an active build-out again. The franchisee will see the normal lifecycle tracker (not the simplified operations view), and the standard build-out checklist (~963 tasks) will be seeded now."
      : `This marks the project as an active build-out again. The franchisee will see the normal lifecycle tracker. This project already has ${taskCount} task(s), so nothing new will be seeded.`
    : `This marks the project as already built and operating. The franchisee will see a simplified operations view (sales, complaints, documents) instead of the build-out tracker, and BOQ/Operations will drop out of their navigation. This does NOT delete the ${taskCount} existing task(s) — delete and recreate the project instead if you want a clean slate.`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}?</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {state?.error && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <form action={action}>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : label}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
