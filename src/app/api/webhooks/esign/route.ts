import { NextResponse } from "next/server";
import { getEsignProvider } from "@/lib/esign";
import { processEsignEvent } from "@/lib/esign/webhook-processor";

/**
 * plan.md section 17: public route (unauthenticated — a real vendor can't
 * carry our session cookie), signature-verified inside. Read the raw body
 * first (verification needs the exact bytes, not a re-serialized parse),
 * verify signature before trusting anything in the payload, then hand off
 * to the shared processor (webhook-processor.ts) so this route and the
 * Admin reconcile action can never disagree about what a status means.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();

  let provider;
  try {
    provider = getEsignProvider();
  } catch (err) {
    console.error("E-sign webhook received but no provider is configured:", err);
    return NextResponse.json({ error: "E-sign provider not configured." }, { status: 500 });
  }

  let parsed;
  try {
    parsed = await provider.parseAndVerifyWebhook(rawBody, request.headers);
  } catch (err) {
    console.error("E-sign webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const result = await processEsignEvent(parsed, true);

  // Always 200 once we've recorded the event (even FAILED/IGNORED_LATE) —
  // the provider shouldn't keep retrying a webhook we've successfully
  // received and logged; Admin's retryable failed-event view
  // (/admin/esign-events) is the real recovery path (P1-10).
  return NextResponse.json({ ok: true, outcome: result.outcome, message: result.message });
}
