import { Suspense } from "react";
import { db } from "@/lib/db";
import { canTriggerUnifiedSync } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/session";
import { getSyncStatus } from "@/lib/sync-batch/view";
import { UnifiedSyncButton } from "./unified-sync-button";

async function UnifiedSyncControl() {
  const initial = await getSyncStatus(db);
  return <UnifiedSyncButton initial={initial} />;
}

/**
 * Drop-in for PageHeader's `action` slot on Dashboard, Site Tracker, Site BOQ
 * and Operations BOQ. Admin only: for anyone else it renders nothing (no
 * placeholder, so nobody else sees a gap). For an admin the one small status
 * read is streamed behind Suspense with a same-size placeholder, so it never
 * delays the page's own content or shifts the layout when it arrives.
 */
export function UnifiedSyncSlot({ user }: { user: Pick<CurrentUser, "role"> }) {
  if (!canTriggerUnifiedSync(user)) return null;
  return (
    <Suspense fallback={<div className="h-[3.25rem] w-24" aria-hidden="true" />}>
      <UnifiedSyncControl />
    </Suspense>
  );
}
