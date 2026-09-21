"use client";

import { useState } from "react";
import { useActionState } from "react";
import { deleteProject, type DeleteProjectState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

export function DeleteProjectButton({
  projectId,
  brand,
  location,
}: {
  projectId: string;
  brand: string;
  location: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const boundAction = deleteProject.bind(null, projectId);
  const [state, action, pending] = useActionState<DeleteProjectState, FormData>(boundAction, undefined);

  // Type-to-confirm gate, added after Apoorv asked for one on top of the
  // plain dialog — the exact phrase includes the project's own brand +
  // location so it can't be muscle-memory-typed for the wrong project.
  const confirmPhrase = `Delete project: ${brand} ${location}`;
  const isConfirmed = confirmText === confirmPhrase;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmText("");
      }}
    >
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Delete project
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete {brand} — {location}?
          </DialogTitle>
          <DialogDescription>
            This project and all of its tasks, documents, and comments will be permanently removed. This
            can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label htmlFor="delete-project-confirm" className="text-sm text-muted-foreground">
            Type <span className="font-mono font-medium text-foreground">{confirmPhrase}</span> to confirm.
          </label>
          <Input
            id="delete-project-confirm"
            autoComplete="off"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={confirmPhrase}
          />
        </div>

        {state?.error && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <form action={action}>
            <Button type="submit" variant="destructive" disabled={pending || !isConfirmed}>
              {pending ? "Deleting…" : "Delete project"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
