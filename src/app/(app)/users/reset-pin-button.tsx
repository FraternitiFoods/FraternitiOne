"use client";

import { useActionState, useState } from "react";
import { resetPin, type ResetPinState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

export function ResetPinButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const boundAction = resetPin.bind(null, userId);
  const [state, action, pending] = useActionState<ResetPinState, FormData>(boundAction, undefined);

  const dialogOpen = open && !state?.success;

  return (
    <Dialog open={dialogOpen} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        Reset PIN
      </Button>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Reset PIN for {name}</DialogTitle>
            <DialogDescription>
              Sets a new 6-digit PIN immediately. Tell {name} the new PIN directly — there&apos;s no
              email/SMS for this (plan.md section 16).
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`pin-${userId}`}>New PIN</Label>
              <Input
                id={`pin-${userId}`}
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                placeholder="••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`confirmPin-${userId}`}>Confirm PIN</Label>
              <Input
                id={`confirmPin-${userId}`}
                name="confirmPin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                placeholder="••••••"
              />
            </div>
          </div>

          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Reset PIN"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
