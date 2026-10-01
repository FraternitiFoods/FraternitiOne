import { getMockSmsOutbox } from "@/lib/sms/mock-provider";
import { RefreshButton } from "./refresh-button";

/**
 * plan.md section 19 "SMS adapter": the mock provider's stand-in for a real
 * phone's SMS inbox. Refuses to render its real content outside dev/mock
 * (see also getSmsProvider()'s guard — defense in depth, not the only gate).
 * No app session/auth here on purpose, same reasoning as /dev/mock-esign:
 * this page stands in for the signer's *own phone*, which carries no app
 * cookie either.
 */
export default async function MockSmsPage() {
  const unavailable = process.env.NODE_ENV === "production" || process.env.SMS_PROVIDER !== "mock";

  if (unavailable) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">Mock SMS inbox not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page only renders when SMS_PROVIDER=mock and outside production.
        </p>
      </div>
    );
  }

  const outbox = getMockSmsOutbox();

  return (
    <div className="mx-auto max-w-lg space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Mock SMS inbox</h1>
          <p className="mt-1 text-xs font-medium text-destructive">
            TEST OTP — not a real SMS, no legal value, not production sign-off.
          </p>
        </div>
        <RefreshButton />
      </div>

      {outbox.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No mock SMS sent yet in this server process. Request an OTP, then refresh this page.
        </p>
      ) : (
        <ul className="space-y-3">
          {outbox.map((sms) => (
            <li key={sms.id} className="rounded-md border p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{sms.to}</span>
                <span className="text-xs text-muted-foreground">{sms.sentAt.toLocaleTimeString("en-IN")}</span>
              </div>
              <div className="mt-2 text-2xl font-mono font-semibold tracking-widest">{sms.code}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {sms.vars.store ? `LOI OTP for ${sms.vars.store}` : "LOI OTP"}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        This inbox is in-memory for the current server process only — it is never written to the
        database, a log, or any audit/notification record. It resets whenever the dev server restarts.
      </p>
    </div>
  );
}
