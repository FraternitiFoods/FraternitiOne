"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
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
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive">{state.error}</p>
            {state.blockers && state.blockers.length > 0 && (
              <ul className="space-y-1 rounded-md bg-destructive/5 p-2 text-sm">
                {state.blockers.map((b) => (
                  <li key={b.href + b.label}>
                    <Link
                      href={b.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {b.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {state.blockersNote && (
              <p className="text-xs text-muted-foreground">{state.blockersNote}</p>
            )}
          </div>
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
