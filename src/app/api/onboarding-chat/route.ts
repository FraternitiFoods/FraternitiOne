import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { GeminiError, isGeminiConfigured, streamGeminiReply } from "@/lib/gemini";
import { buildSystemPrompt, chatRequestSchema } from "@/lib/onboarding/chat-prompt";
import { createRateLimiter } from "@/lib/onboarding/chat-rate-limit";

/**
 * Franchisee onboarding assistant (Gemini). Authorization mirrors the
 * /onboarding portal: the onboarding record is resolved from the SESSION
 * (`franchiseeUserId: user.id`), never from anything in the request body, so a
 * franchisee can only ever put their own status into the prompt.
 *
 * Uses getCurrentUser() + JSON errors rather than requireUser(): requireUser()
 * redirects, which is right for pages but not for a fetch() from the chat box.
 */
const limiter = createRateLimiter(8, 60_000);

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json("Please log in again.", 401);
  if (user.role !== "FRANCHISEE") return json("Not available.", 403);

  if (!isGeminiConfigured()) return json("The assistant isn't set up yet. Please ask your Sales contact.", 503);

  if (!limiter.check(user.id)) return json("You're sending messages too fast. Please wait a moment.", 429);

  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json("That message couldn't be read. Please try again.", 400);

  const onboarding = await db.storeOnboarding.findUnique({
    where: { franchiseeUserId: user.id },
    relationLoadStrategy: "join",
    select: {
      seq: true,
      brand: true,
      proposedLocation: true,
      entityType: true,
      onboardingStatus: true,
      kycStatus: true,
      paymentStatus: true,
      expectedAmount: true,
      salesOwner: { select: { name: true, email: true } },
    },
  });
  if (!onboarding) return json("No onboarding found for your account.", 404);

  try {
    const stream = await streamGeminiReply({
      system: buildSystemPrompt({ name: user.name, ...onboarding }),
      messages: parsed.data.messages,
      signal: request.signal,
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        // Stop proxies from buffering the stream; tokens should reach the browser as they arrive.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[onboarding-chat]", err);
    if (err instanceof GeminiError && err.status === 429) {
      return json("The assistant is busy right now. Please try again in a minute.", 429);
    }
    return json("The assistant is unavailable right now. Please try again shortly.", 502);
  }
}
