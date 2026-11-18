import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canTriggerUnifiedSync } from "@/lib/permissions";
import { ALL_LEGS, claimBatch } from "@/lib/sync-batch/claim";
import { kickLegs, legLabel, missingConfig } from "@/lib/sync-batch/trigger";

// `after()` below holds the Apps Script web-app calls open (doPost answers only
// when its whole run is done). It runs for this route's maxDuration, so this
// must stay at the same 300s the sheet-sync/dashboard-sync `finish` routes use.
export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z
  .object({
    /** Retry just these legs (a failed chip's Retry button). Omitted = all three. */
    legs: z.array(z.enum(["STAGES", "SITE_BOQ", "OPS_BOQ"])).min(1).optional(),
    /** Re-sync every unit even if its content hash is unchanged. Not exposed in the UI. */
    force: z.boolean().optional(),
  })
  .strict();

/**
 * POST /api/sync/run — the unified "Sync" button. Admin only (session).
 * Claims a batch (or attaches to the one already running), answers at once
 * with {batchId}, and does the slow part — calling the three sheets' web apps
 * in parallel — after the response, so the page never blocks.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  if (!canTriggerUnifiedSync(user)) {
    return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  }

  let parsed;
  try {
    const text = await request.text();
    parsed = bodySchema.safeParse(text.trim() === "" ? {} : JSON.parse(text));
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const legs = parsed.data.legs ?? [...ALL_LEGS];
  const missing = missingConfig(legs);
  if (missing.length > 0) {
    // Names only, never values. 503 (not a boot failure) so the rest of the app is unaffected.
    return NextResponse.json(
      { error: `Sync isn't configured on the server yet: ${missing.join(", ")}.`, missing },
      { status: 503 }
    );
  }

  const force = parsed.data.force === true;
  const claim = await claimBatch(db, { userId: user.id, legs, force });

  if (claim.created) {
    after(() => kickLegs(db, claim.batchId, claim.legs, force));
  }

  return NextResponse.json({
    batchId: claim.batchId,
    created: claim.created,
    legs: claim.legs.map((leg) => ({ leg, label: legLabel(leg) })),
  });
}
