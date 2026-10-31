"use client";

import { useActionState, useState } from "react";
import { setMode, type ActionState } from "../actions";
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
import type { ImportMode } from "@/lib/app-settings";

const MODE_LABEL: Record<ImportMode, string> = {
  SHEET_LIVE: "Sheet live",
  WEBSITE_LIVE: "Website live",
};

const SWITCH_EXPLANATION: Record<ImportMode, string> = {
  WEBSITE_LIVE:
    "The sheet's push will stop working — every /api/import/boq/* request will get 403 — and editing turns on here, following each role's permissions (plan.md section 5). Vendor contact details, Settings and Purchase Orders already work in either mode.",
  SHEET_LIVE:
    "Editing turns off for everyone here (except vendor contact details, Settings and Purchase Orders), and the sheet's push resumes — its next run will overwrite BOQ data on the website again.",
};

/**
 * plan.md section 1 "Only an Admin can flip mode, from Settings, with a
 * confirmation dialog explaining it is a one-way switch in practice." Keyed
 * by `currentMode` from the parent (see settings/page.tsx) so a successful
 * switch remounts this with fresh dialog state instead of getting stuck
 * closed by a stale `state.success` from the previous mode.
 */
export function ModeSwitch({ currentMode }: { currentMode: ImportMode }) {
  const targetMode: ImportMode = currentMode === "SHEET_LIVE" ? "WEBSITE_LIVE" : "SHEET_LIVE";
  const [open, setOpen] = useState(false);
  const boundAction = setMode.bind(null, targetMode);
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);

  const dialogOpen = open && !state?.success;

  return (
    <Dialog open={dialogOpen} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Switch to {MODE_LABEL[targetMode]}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Switch to {MODE_LABEL[targetMode]}?</DialogTitle>
          <DialogDescription>{SWITCH_EXPLANATION[targetMode]}</DialogDescription>
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
              {pending ? "Switching…" : `Switch to ${MODE_LABEL[targetMode]}`}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
