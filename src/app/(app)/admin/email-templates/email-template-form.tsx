"use client";

import { useActionState } from "react";
import { updateEmailTemplate } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmailKey } from "@/lib/onboarding/notify";

export function EmailTemplateForm({
  templateKey,
  subject,
  body,
  enabled,
}: {
  templateKey: EmailKey;
  subject: string;
  body: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(updateEmailTemplate.bind(null, templateKey), undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{templateKey}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`${templateKey}-subject`}>Subject</Label>
            <Input id={`${templateKey}-subject`} name="subject" defaultValue={subject} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${templateKey}-body`}>Body</Label>
            <Textarea id={`${templateKey}-body`} name="body" defaultValue={body} rows={5} required />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={enabled} />
            Enabled
          </label>
          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}
          {state?.success && <p className="text-sm text-emerald-600">Saved.</p>}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
