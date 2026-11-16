"use client";

import { useActionState, useState } from "react";
import { deleteOnboarding, type DeleteOnboardingState } from "./actions";
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

export function DeleteOnboardingButton({
  onboardingId,
  storeLabel,
  franchiseeEmail,
}: {
  onboardingId: string;
  storeLabel: string;
  franchiseeEmail: string | null;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = deleteOnboarding.bind(null, onboardingId);
  const [state, action, pending] = useActionState<DeleteOnboardingState, FormData>(boundAction, undefined);

  // Same derived-not-effect reasoning as DeleteUserButton: a failed attempt
  // (e.g. already converted to a project) must keep the dialog open with the
  // error visible, while a successful one closes it.
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
          <DialogTitle>Delete {storeLabel}?</DialogTitle>
          <DialogDescription>
            This onboarding{franchiseeEmail ? ` (${franchiseeEmail})` : ""} — its KYC, payment proof, and LOI
            history — will be permanently removed. This can&apos;t be undone. The franchisee&apos;s login
            account itself is untouched.
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
