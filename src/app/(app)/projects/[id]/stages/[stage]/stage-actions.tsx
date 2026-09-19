"use client";

import { useActionState } from "react";
import { forceCompleteStage, revertStageOverride, type ActionState } from "../../actions";
import { Button } from "@/components/ui/button";
import type { LifecycleStage } from "@prisma/client";

export function StageActions({
  projectId,
  stage,
  isOverridden,
}: {
  projectId: string;
  stage: LifecycleStage;
  isOverridden: boolean;
}) {
  const redirectTo = `/projects/${projectId}/stages/${stage}`;

  const [forceCompleteState, forceCompleteFormAction, forceCompletePending] = useActionState<
    ActionState,
    FormData
  >(forceCompleteStage.bind(null, projectId, stage, redirectTo), undefined);
  const [revertState, revertFormAction, revertPending] = useActionState<ActionState, FormData>(
    revertStageOverride.bind(null, projectId, stage, redirectTo),
    undefined
  );

  return (
    <form action={isOverridden ? revertFormAction : forceCompleteFormAction}>
      <Button type="submit" size="sm" variant="outline" disabled={forceCompletePending || revertPending}>
        {isOverridden
          ? revertPending
            ? "Reopening…"
            : "Reopen stage"
          : forceCompletePending
            ? "Marking…"
            : "Mark stage complete"}
      </Button>
      {(forceCompleteState?.error || revertState?.error) && (
        <p className="mt-1 text-xs text-destructive">
          {forceCompleteState?.error || revertState?.error}
        </p>
      )}
    </form>
  );
}
