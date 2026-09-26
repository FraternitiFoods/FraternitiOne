"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageOnboardingAdmin } from "@/lib/permissions";
import { writeAuditEvent } from "@/lib/audit";
import type { EmailKey } from "@/lib/onboarding/notify";

export type UpdateTemplateState = { error?: string; success?: boolean } | undefined;

/** Admin-only. Edits subject/body/enabled for one EmailTemplate key — self-seeds the row if it doesn't exist yet. */
export async function updateEmailTemplate(
  key: EmailKey,
  _prevState: UpdateTemplateState,
  formData: FormData
): Promise<UpdateTemplateState> {
  const user = await requireUser();
  if (!canManageOnboardingAdmin(user)) {
    return { error: "You don't have permission to do this." };
  }

  const subject = String(formData.get("subject") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const enabled = formData.get("enabled") === "on";

  if (!subject || !body) {
    return { error: "Subject and body are required." };
  }

  const existing = await db.emailTemplate.findUnique({ where: { key } });

  await db.emailTemplate.upsert({
    where: { key },
    update: { subject, body, enabled },
    create: { key, subject, body, enabled },
  });

  await writeAuditEvent(db, {
    actor: user,
    projectId: null,
    entityType: "EmailTemplate",
    entityId: key,
    action: existing ? "UPDATE" : "CREATE",
    oldValue: existing ? { subject: existing.subject, body: existing.body, enabled: existing.enabled } : undefined,
    newValue: { subject, body, enabled },
    reference: "Edited via /admin/email-templates",
  });

  revalidatePath("/admin/email-templates");
  return { success: true };
}
