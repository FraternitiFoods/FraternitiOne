import "server-only";

import { geminiSseToTextStream } from "@/lib/gemini-sse";
import type { ChatMessage } from "@/lib/onboarding/chat-prompt";

/**
 * Server-side Gemini call. Plain fetch against the REST API (no SDK) keeps the
 * serverless bundle and cold start small. The API key only ever lives in
 * GEMINI_API_KEY on the server; it is never sent to the browser.
 *
 * Model: GEMINI_MODEL, default the fastest stable Flash-Lite listed in Google's
 * model docs on 2026-11-14. Override via env without a code change if Google
 * retires or renames it.
 */
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
/** Whole reply, headers + streaming. */
const TOTAL_TIMEOUT_MS = 30_000;
/** Time to first byte per attempt. Free-tier Gemini occasionally stalls; a fresh attempt is usually fast. */
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 2;
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const EMPTY_REPLY_FALLBACK =
  "Sorry, I couldn't come up with an answer to that. Please ask your Sales contact.";

export class GeminiError extends Error {
  constructor(
    /** 503 = not configured, otherwise the upstream HTTP status (0 = network/timeout). */
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function streamGeminiReply(args: {
  system: string;
  messages: ChatMessage[];
  /** Aborts the upstream call when the browser goes away. */
  signal?: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError(503, "GEMINI_API_KEY is not set");

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const total = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: args.system }] },
    contents: args.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    // Short answers by design; the cap also bounds cost and latency. Gemini 3.x accepts a thinking level;
    // "minimal" (near-off) measured a little faster and steadier on 2026-11-14 (median ~0.95s vs ~1.2s to first chunk).
    // Only sent for 3.x ids: an older model set via GEMINI_MODEL may reject the field.
    generationConfig: {
      maxOutputTokens: 1024,
      ...(model.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
    },
  });

  // Transient failures (connection error, connect timeout, 5xx) get one more attempt: no text has reached the
  // browser yet, so retrying is invisible apart from the wait. 429 and 4xx are NOT retried (quota/bad request).
  let lastError: GeminiError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const connect = new AbortController();
    const connectTimer = setTimeout(() => connect.abort(), CONNECT_TIMEOUT_MS);
    const signal = AbortSignal.any([total, connect.signal, ...(args.signal ? [args.signal] : [])]);

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: requestBody,
        signal,
      });
    } catch (err) {
      clearTimeout(connectTimer);
      if (args.signal?.aborted) throw new GeminiError(0, "Request cancelled by the client");
      lastError = new GeminiError(0, `Gemini request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (total.aborted) break;
      continue;
    }
    clearTimeout(connectTimer); // headers arrived: from here only the total timeout applies

    if (res.ok && res.body) return geminiSseToTextStream(res.body, EMPTY_REPLY_FALLBACK);

    // Server console only; never forwarded to the franchisee. Truncated: error bodies can be long.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    lastError = new GeminiError(res.status, `Gemini returned ${res.status}: ${detail}`);
    if (!RETRYABLE_STATUS.has(res.status)) break;
  }
  throw lastError ?? new GeminiError(0, "Gemini request failed");
}
