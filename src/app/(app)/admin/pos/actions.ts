"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canManagePosIntegration } from "@/lib/permissions";
import { dateKeyToDate, toUtcDateKey } from "@/lib/sales/parse-csv";
import { aggregateAndWriteSalesDay, reprocessStoredEvent } from "@/lib/pos/webhook-processor";

export type ActionState = { error?: string } | undefined;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * plan.md section 26 `/admin/pos` outlet mapping (1): sets/clears
 * `petpoojaRestId` and `posLiveFrom` for one project. Audited (decision 7
 * explicitly lists "map an outlet, set go-live date" as a human action that
 * gets an `AuditEvent`, unlike the webhook's own automatic per-bill writes).
 */
export async function updateOutletMapping(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!canManagePosIntegration(user)) {
    return { error: "You don't have permission to do this." };
  }

  const restIdRaw = formData.get("petpoojaRestId");
  const posLiveFromRaw = formData.get("posLiveFrom");

  const petpoojaRestId =
    typeof restIdRaw === "string" && restIdRaw.trim() !== "" ? restIdRaw.trim().toLowerCase() : null;

  let posLiveFrom: Date | null = null;
  if (typeof posLiveFromRaw === "string" && posLiveFromRaw.trim() !== "") {
    if (!DATE_KEY_RE.test(posLiveFromRaw.trim())) {
      return { error: "Go-live date must be a valid date." };
    }
    posLiveFrom = dateKeyToDate(posLiveFromRaw.trim());
  }

  try {
    await db.$transaction(async (tx) => {
      const existing = await tx.franchiseProject.findUniqueOrThrow({
        where: { id: projectId },
        select: { petpoojaRestId: true, posLiveFrom: true },
      });

      await tx.franchiseProject.update({
        where: { id: projectId },
        data: { petpoojaRestId, posLiveFrom },
      });

      await writeAuditEvent(tx, {
        actor: user,
        projectId,
        entityType: "FranchiseProject",
        entityId: projectId,
        action: "UPDATE",
        oldValue: {
          petpoojaRestId: existing.petpoojaRestId,
          posLiveFrom: existing.posLiveFrom ? toUtcDateKey(existing.posLiveFrom) : null,
        },
        newValue: {
          petpoojaRestId,
          posLiveFrom: posLiveFrom ? toUtcDateKey(posLiveFrom) : null,
        },
        reference: "POS outlet mapping (/admin/pos)",
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "That Petpooja outlet ID is already mapped to another project." };
    }
    throw err;
  }

  revalidatePath("/admin/pos");
  return {};
}

export type ReprocessActionResult = { error?: string; outcome?: string };

/**
 * plan.md section 26 `/admin/pos` problem events (3): re-runs a stored
 * `FAILED`/`IGNORED_UNKNOWN_OUTLET` payload through the real parse+ingest
 * path. Audited (decision 7: "retry a failed event" is a listed human
 * action) in addition to the `reprocessedAt`/`reprocessedById` stamp
 * `reprocessStoredEvent` itself writes on the event row.
 */
export async function reprocessEvent(eventId: string): Promise<ReprocessActionResult> {
  const user = await requireUser();
  if (!canManagePosIntegration(user)) {
    return { error: "You don't have permission to do this." };
  }

  const result = await reprocessStoredEvent(eventId, user.id);

  await writeAuditEvent(db, {
    actor: user,
    entityType: "PosWebhookEvent",
    entityId: eventId,
    action: "UPDATE",
    newValue: { outcome: result.outcome, message: result.message },
    reference: "Reprocessed a failed Petpooja event (/admin/pos)",
  });

  revalidatePath("/admin/pos");

  if (result.outcome !== "PROCESSED") {
    return { error: result.message ?? result.outcome, outcome: result.outcome };
  }
  return { outcome: result.outcome };
}

/**
 * plan.md section 26 "Pinning": "'Unpin and recompute' is an Admin action."
 * Unlike the webhook's own guarded recompute, this always recomputes once
 * unpinned — the admin is explicitly asking for it, so `posLiveFrom` gating
 * doesn't apply here.
 */
export async function unpinSalesDay(salesDayId: string): Promise<ActionState> {
  const user = await requireUser();
  if (!canManagePosIntegration(user)) {
    return { error: "You don't have permission to do this." };
  }

  await db.$transaction(async (tx) => {
    const existing = await tx.salesDay.findUniqueOrThrow({ where: { id: salesDayId } });

    await tx.salesDay.update({ where: { id: salesDayId }, data: { isPinned: false } });
    await aggregateAndWriteSalesDay(tx, existing.projectId, existing.date);

    await writeAuditEvent(tx, {
      actor: user,
      projectId: existing.projectId,
      entityType: "SalesDay",
      entityId: salesDayId,
      action: "UPDATE",
      oldValue: { isPinned: true },
      newValue: { isPinned: false },
      reference: "Unpinned and recomputed from POS data (/admin/pos)",
    });
  });

  revalidatePath("/admin/pos");
  revalidatePath("/sales");
  return {};
}
