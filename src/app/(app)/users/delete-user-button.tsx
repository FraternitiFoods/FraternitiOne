"use client";

import { useActionState, useState } from "react";
import { deleteUser, type DeleteUserState } from "./actions";
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

export function DeleteUserButton({ userId, name, email }: { userId: string; name: string; email: string | null }) {
  const [open, setOpen] = useState(false);
  const boundAction = deleteUser.bind(null, userId);
  const [state, action, pending] = useActionState<DeleteUserState, FormData>(boundAction, undefined);

  // Derived, not an effect: once a submission succeeds the dialog should
  // close, but a failed attempt (e.g. blocked by a foreign key constraint)
  // must stay open with the error visible. Computing this during render
  // avoids a setState-in-effect (the row also unmounts on success anyway,
  // once revalidatePath refetches the now-shorter user list).
  const dialogOpen = open && !state?.success;

  return (
    <Dialog open={dialogOpen} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>
            {email ?? "This account"} will be permanently removed. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        {state?.error && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <form action={action}>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
