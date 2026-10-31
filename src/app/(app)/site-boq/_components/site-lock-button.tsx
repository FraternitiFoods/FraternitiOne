"use client";

import { useActionState, useState } from "react";
import { lockSite, unlockSite, type ActionState } from "../sites/actions";
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

const LOCK_EXPLANATION =
  "This site's quantities and rates will be frozen. Later changes to item rates will not change this site's amounts.";
const UNLOCK_EXPLANATION =
  "This site's quantities, remarks and tracking fields become editable again, and its amounts will follow item rate changes once more.";

/**
 * plan.md section 3 "Site lock" — Admin-only lock/unlock button with a
 * confirmation dialog, shared between the Sites list and Site view (both
 * show a lock control for a given site). Outer/inner split (same pattern as
 * mode-switch.tsx, tracking-drawer.tsx etc.): the inner component remounts
 * fresh on every open via `key`, so a stale `state.success` left over from
 * locking can't leave the dialog stuck closed the first time "Unlock" is
 * clicked right after.
 */
export function SiteLockButton({
  siteId,
  siteName,
  isLocked,
}: {
  siteId: string;
  siteName: string;
  isLocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [instanceKey, setInstanceKey] = useState(0);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setInstanceKey((k) => k + 1);
          setOpen(true);
        }}
      >
        {isLocked ? "Unlock" : "Lock"}
      </Button>
      <SiteLockDialogContent
        key={instanceKey}
        open={open}
        onOpenChange={setOpen}
        siteId={siteId}
        siteName={siteName}
        isLocked={isLocked}
      />
    </>
  );
}

function SiteLockDialogContent({
  open,
  onOpenChange,
  siteId,
  siteName,
  isLocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  siteName: string;
  isLocked: boolean;
}) {
  const boundAction = (isLocked ? unlockSite : lockSite).bind(null, siteId);
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);
  const dialogOpen = open && !state?.success;

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isLocked ? `Unlock "${siteName}"?` : `Lock "${siteName}"?`}</DialogTitle>
          <DialogDescription>{isLocked ? UNLOCK_EXPLANATION : LOCK_EXPLANATION}</DialogDescription>
        </DialogHeader>

        {state?.error && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
          <form action={action}>
            <Button type="submit" disabled={pending}>
              {pending ? (isLocked ? "Unlocking…" : "Locking…") : isLocked ? "Unlock site" : "Lock site"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
