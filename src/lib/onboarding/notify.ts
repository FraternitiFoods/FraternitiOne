import "server-only";

import { Resend } from "resend";
import { db } from "@/lib/db";

/**
 * plan.md section 17 "Emails": the small fixed set of onboarding emails,
 * sent via Resend. Self-seeding: the first send for a key upserts its
 * default subject/body into EmailTemplate if no row exists yet (same
 * self-healing spirit as the mobile flow's "Other" task, plan.md section 16
 * decision 12) — Admin can then edit subject/body from /admin/email-templates
 * (step 8) without a separate manual seed step ever being required.
 *
 * P1-14: failure of email/notification must never fail the business action.
 * Every attempt — success or failure — is logged to NotificationLog instead
 * of thrown.
 */

export type EmailKey =
  | "invitation"
  | "correction_request"
  | "payment_accepted"
  | "payment_rejected"
  | "signing_ready"
  | "franchise_signed"
  | "company_signed"
  | "loi_complete";

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailKey, { subject: string; body: string }> = {
  invitation: {
    subject: "Welcome to Fraterniti One — set your password",
    body: "Hi {{name}},\n\nYour store onboarding ({{store}}) has started. Set your password to get started:\n\n{{link}}\n\nThis link expires in 7 days.",
  },
  correction_request: {
    subject: "Action needed on your {{store}} onboarding",
    body: "Hi {{name}},\n\nWe need a correction on your submission:\n\n{{reason}}\n\nPlease log in and re-upload: {{link}}",
  },
  payment_accepted: {
    subject: "Payment confirmed for {{store}}",
    body: "Hi {{name}},\n\nYour payment for {{store}} has been verified and accepted. Log in for the latest status: {{link}}",
  },
  payment_rejected: {
    subject: "Payment receipt needs correction — {{store}}",
    body: "Hi {{name}},\n\nYour payment receipt for {{store}} could not be accepted:\n\n{{reason}}\n\nPlease re-upload: {{link}}",
  },
  signing_ready: {
    subject: "Your LOI is ready to sign — {{store}}",
    body: "Hi {{name}},\n\nYour Letter of Intent for {{store}} is ready. Log in to proceed with Aadhaar e-sign: {{link}}",
  },
  franchise_signed: {
    subject: "LOI signed — awaiting company countersignature ({{store}})",
    body: "Hi {{name}},\n\nThe franchisee has signed the LOI for {{store}}. It's now awaiting the company signatory.",
  },
  company_signed: {
    subject: "LOI countersigned — {{store}}",
    body: "Hi {{name}},\n\nThe company has countersigned the LOI for {{store}}.",
  },
  loi_complete: {
    subject: "LOI complete — {{store}} project created",
    body: "Hi {{name}},\n\nThe LOI for {{store}} is fully signed and your project has been created. Log in to view it: {{link}}",
  },
};

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

/**
 * Fires the "signing_ready" email the first moment onboardingStatus crosses
 * into READY_FOR_SIGNATURE — called after every mutation that can cause that
 * crossing (KYC accept, payment accept, LOI release), each of which passes
 * the {previousStatus, nextStatus} pair recomputeOnboardingStatus returns so
 * this only fires once, not on every subsequent recompute that leaves it at
 * READY_FOR_SIGNATURE already.
 */
export async function notifyIfNewlyReadyForSignature(
  recompute: { previousStatus: string; nextStatus: string },
  onboarding: { id: string; brand: string; proposedLocation: string; franchisee: { name: string; email: string | null } }
): Promise<void> {
  if (recompute.previousStatus === "READY_FOR_SIGNATURE" || recompute.nextStatus !== "READY_FOR_SIGNATURE") {
    return;
  }
  if (!onboarding.franchisee.email) return;
  await sendOnboardingEmail({
    key: "signing_ready",
    to: onboarding.franchisee.email,
    onboardingId: onboarding.id,
    vars: {
      name: onboarding.franchisee.name,
      store: `${onboarding.brand} ${onboarding.proposedLocation}`,
      link: `${process.env.APP_URL || "http://localhost:3000"}/onboarding/loi`,
    },
  });
}

export async function sendOnboardingEmail(params: {
  key: EmailKey;
  to: string;
  onboardingId: string;
  vars: Record<string, string>;
}): Promise<void> {
  const template = await db.emailTemplate.upsert({
    where: { key: params.key },
    update: {},
    create: {
      key: params.key,
      subject: DEFAULT_EMAIL_TEMPLATES[params.key].subject,
      body: DEFAULT_EMAIL_TEMPLATES[params.key].body,
    },
  });

  if (!template.enabled) {
    await db.notificationLog.create({
      data: { templateKey: params.key, to: params.to, onboardingId: params.onboardingId, status: "SKIPPED_DISABLED" },
    });
    return;
  }

  const subject = renderTemplate(template.subject, params.vars);
  const body = renderTemplate(template.body, params.vars);

  try {
    const client = getClient();
    const from = process.env.EMAIL_FROM;
    if (!client || !from) {
      throw new Error("RESEND_API_KEY / EMAIL_FROM not configured.");
    }
    await client.emails.send({
      from,
      to: params.to,
      subject,
      text: body,
      html: body.replace(/\n/g, "<br/>"),
    });
    await db.notificationLog.create({
      data: { templateKey: params.key, to: params.to, onboardingId: params.onboardingId, status: "SENT" },
    });
  } catch (err) {
    console.error(`Failed to send onboarding email "${params.key}":`, err);
    await db.notificationLog.create({
      data: {
        templateKey: params.key,
        to: params.to,
        onboardingId: params.onboardingId,
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
