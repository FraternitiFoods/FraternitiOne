import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageOnboardingAdmin } from "@/lib/permissions";
import { DEFAULT_EMAIL_TEMPLATES, type EmailKey } from "@/lib/onboarding/notify";
import { EmailTemplateForm } from "./email-template-form";

const KEYS = Object.keys(DEFAULT_EMAIL_TEMPLATES) as EmailKey[];

/** Admin-only. Edits the 8 onboarding email templates (plan.md section 17 "Emails"). */
export default async function EmailTemplatesPage() {
  const user = await requireUser();
  if (!canManageOnboardingAdmin(user)) redirect("/dashboard");

  const existing = await db.emailTemplate.findMany({ where: { key: { in: KEYS } } });
  const byKey = new Map(existing.map((t) => [t.key, t]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Email Templates</h1>
        <p className="text-sm text-muted-foreground">
          {"{{name}}"}, {"{{store}}"}, {"{{reason}}"}, {"{{link}}"} are substituted at send time. A template
          not yet edited shows its built-in default and self-seeds on first send.
        </p>
      </div>

      <div className="space-y-4">
        {KEYS.map((key) => {
          const row = byKey.get(key);
          const defaults = DEFAULT_EMAIL_TEMPLATES[key];
          return (
            <EmailTemplateForm
              key={key}
              templateKey={key}
              subject={row?.subject ?? defaults.subject}
              body={row?.body ?? defaults.body}
              enabled={row?.enabled ?? true}
            />
          );
        })}
      </div>
    </div>
  );
}
