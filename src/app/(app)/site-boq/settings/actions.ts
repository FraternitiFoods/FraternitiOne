"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canEditSettings, canFlipMode } from "@/lib/permissions";
import { getAppSettings, type ImportMode } from "@/lib/app-settings";

export type ActionState = { error?: string; success?: boolean } | undefined;

const SettingsSchema = z.object({
  companyName: z.string().trim().optional().default(""),
  companyAddress: z.string().trim().optional().default(""),
  companyGstin: z.string().trim().optional().default(""),
  companyPhone: z.string().trim().optional().default(""),
  companyEmail: z.string().trim().optional().default(""),
  signatoryName: z.string().trim().optional().default(""),
  defaultGstPercent: z.coerce.number().min(0, "GST % can't be negative.").max(100, "GST % can't exceed 100."),
  defaultPaymentTerms: z.string().trim().min(1, "Default payment terms are required."),
  defaultDeliveryDays: z.coerce.number().int().min(0, "Delivery days can't be negative."),
  poTerm0: z.string().trim().min(1, "All 4 PO terms are required."),
  poTerm1: z.string().trim().min(1, "All 4 PO terms are required."),
  poTerm2: z.string().trim().min(1, "All 4 PO terms are required."),
  poTerm3: z.string().trim().min(1, "All 4 PO terms are required."),
  urgentDays: z.coerce.number().int().min(0, "Urgent-days threshold can't be negative."),
  soonDays: z.coerce.number().int().min(0, "Soon-days threshold can't be negative."),
});

/**
 * plan.md section 4.7 — company details, PO defaults/terms, urgency
 * thresholds. Admin only. "settings" is on plan.md section 1's mode-
 * exemption list, so this works in SHEET_LIVE too — no checkModeAllowsWrite
 * call needed here.
 */
export async function updateAppSettings(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditSettings(user)) return { error: "You don't have permission to do this." };

  const parsed = SettingsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const before = await getAppSettings();
  const after = {
    companyName: data.companyName,
    companyAddress: data.companyAddress,
    companyGstin: data.companyGstin,
    companyPhone: data.companyPhone,
    companyEmail: data.companyEmail,
    signatoryName: data.signatoryName,
    defaultGstPercent: data.defaultGstPercent,
    defaultPaymentTerms: data.defaultPaymentTerms,
    defaultDeliveryDays: data.defaultDeliveryDays,
    poTerms: [data.poTerm0, data.poTerm1, data.poTerm2, data.poTerm3],
    urgentDays: data.urgentDays,
    soonDays: data.soonDays,
  };

  await db.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(after)) {
      await tx.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "AppSetting",
      entityId: "settings",
      action: "UPDATE",
      oldValue: {
        companyName: before.companyName,
        companyAddress: before.companyAddress,
        companyGstin: before.companyGstin,
        companyPhone: before.companyPhone,
        companyEmail: before.companyEmail,
        signatoryName: before.signatoryName,
        defaultGstPercent: before.defaultGstPercent,
        defaultPaymentTerms: before.defaultPaymentTerms,
        defaultDeliveryDays: before.defaultDeliveryDays,
        poTerms: before.poTerms,
        urgentDays: before.urgentDays,
        soonDays: before.soonDays,
      },
      newValue: after,
      reference: "Updated via Site BOQ Settings",
    });
  });

  revalidatePath("/site-boq/settings");
  return { success: true };
}

const MODES: ImportMode[] = ["SHEET_LIVE", "WEBSITE_LIVE"];

/**
 * plan.md section 1 — only an Admin can flip `mode`. Deliberately has no
 * checkModeAllowsWrite call: it's the switch that *controls* the gate, so it
 * must work regardless of which mode is currently active (otherwise a stuck
 * WEBSITE_LIVE site could never be moved back, and vice versa).
 */
export async function setMode(
  targetMode: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: ActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!canFlipMode(user)) return { error: "You don't have permission to do this." };

  if (!MODES.includes(targetMode as ImportMode)) return { error: "Invalid mode." };

  const current = await getAppSettings();
  if (current.mode === targetMode) return { success: true };

  await db.$transaction(async (tx) => {
    await tx.appSetting.upsert({
      where: { key: "mode" },
      update: { value: targetMode },
      create: { key: "mode", value: targetMode },
    });

    await writeAuditEvent(tx, {
      actor: user,
      entityType: "AppSetting",
      entityId: "mode",
      action: "UPDATE",
      oldValue: { mode: current.mode },
      newValue: { mode: targetMode },
      reference: "Mode switched via Site BOQ Settings",
    });
  });

  revalidatePath("/site-boq");
  revalidatePath("/site-boq/site-view");
  revalidatePath("/site-boq/items");
  revalidatePath("/site-boq/vendors");
  revalidatePath("/site-boq/sites");
  revalidatePath("/site-boq/settings");
  return { success: true };
}
