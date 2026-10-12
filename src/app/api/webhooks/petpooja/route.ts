import { NextResponse } from "next/server";
import { processPetpoojaWebhook } from "@/lib/pos/webhook-processor";

/**
 * plan.md section 26: public route (unauthenticated — Petpooja can't carry a
 * session cookie), auth is a token/secret check inside the shared processor.
 * `/api/webhooks/petpooja/[secret]` (sibling route) is the same thing with a
 * secret path segment; Petpooja is given one URL or the other, never both.
 * `PETPOOJA_WEBHOOK_ENABLED` gates both at the route level so a dev DB never
 * ingests a real bill by accident (off by default in `.env.example`).
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.PETPOOJA_WEBHOOK_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const rawBody = await request.text();
  const result = await processPetpoojaWebhook(rawBody, undefined);
  return NextResponse.json(result.body, { status: result.status });
}
