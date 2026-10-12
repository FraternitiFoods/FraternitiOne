import { NextResponse } from "next/server";
import { processPetpoojaWebhook } from "@/lib/pos/webhook-processor";

/**
 * Same as `../route.ts`, with the secret taken from the URL path segment
 * instead of (or alongside) a body token — plan.md section 26 "Token vs URL
 * secret": the URL given to Petpooja is `/api/webhooks/petpooja/<secret>`
 * when `PETPOOJA_WEBHOOK_PATH_SECRET` is the chosen auth mechanism.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> }
): Promise<NextResponse> {
  if (process.env.PETPOOJA_WEBHOOK_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { secret } = await params;
  const rawBody = await request.text();
  const result = await processPetpoojaWebhook(rawBody, secret);
  return NextResponse.json(result.body, { status: result.status });
}
