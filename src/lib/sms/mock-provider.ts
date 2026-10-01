import "server-only";

import { randomUUID } from "node:crypto";
import type { SmsProvider, SendSmsInput } from "./provider";

/**
 * plan.md section 19 "SMS adapter": exercises the whole OTP flow locally,
 * same spirit as src/lib/esign/mock-provider.ts. "Sends" nothing — instead
 * keeps a process-local, in-memory outbox that /dev/mock-sms reads. This is
 * the ONE place the plain OTP code exists outside the signer's own head: it
 * is never written to the database, a log line, an AuditEvent, or
 * NotificationLog (section 19's hard rule) — only held in this module-level
 * array for the dev page to display, and only while SMS_PROVIDER=mock and
 * NODE_ENV isn't production (enforced by getSmsProvider() in index.ts, not
 * here — same defense-in-depth split as the e-sign mock).
 *
 * Reserved test number: sending to +919999999999 always throws, so the
 * "failed send leaves no pending challenge" negative test (Definition of
 * Done) is deterministically triggerable without a real provider.
 */

export type MockSentSms = {
  id: string;
  to: string;
  code: string;
  templateKey: string;
  vars: Record<string, string>;
  sentAt: Date;
};

const MOCK_SEND_FAILURE_NUMBER = "+919999999999";
const MAX_OUTBOX_ENTRIES = 50;

const mockOutbox: MockSentSms[] = [];

export class MockSmsProvider implements SmsProvider {
  async send(input: SendSmsInput): Promise<{ providerMessageId: string }> {
    if (input.to === MOCK_SEND_FAILURE_NUMBER) {
      throw new Error("Mock SMS provider: simulated send failure for the reserved test number.");
    }
    const id = `mocksms_${randomUUID()}`;
    mockOutbox.unshift({
      id,
      to: input.to,
      code: input.vars.code ?? "",
      templateKey: input.templateKey,
      vars: input.vars,
      sentAt: new Date(),
    });
    mockOutbox.length = Math.min(mockOutbox.length, MAX_OUTBOX_ENTRIES);
    return { providerMessageId: id };
  }
}

export function getMockSmsOutbox(): MockSentSms[] {
  return mockOutbox;
}
