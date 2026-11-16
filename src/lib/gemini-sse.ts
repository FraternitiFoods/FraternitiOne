/**
 * Turns Gemini's `streamGenerateContent?alt=sse` response into a plain-text
 * stream the browser can read with fetch().body. Pure (no env, no network) so
 * it is unit-testable with a fake body.
 *
 * Wire format: server-sent events separated by a blank line; each event has
 * `data: {json}` whose text is at candidates[0].content.parts[].text. Parts
 * flagged `thought: true` are the model's reasoning summary and are skipped.
 * There is no [DONE] terminator: the stream just ends.
 */

export function extractDeltaText(payload: unknown): string {
  const parts = (payload as { candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] } }[] })
    ?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p && p.thought !== true && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

function textFromEvent(rawEvent: string): string {
  const data = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return "";
  try {
    return extractDeltaText(JSON.parse(data));
  } catch {
    return ""; // a malformed event must not kill the whole reply
  }
}

export function geminiSseToTextStream(
  body: ReadableStream<Uint8Array>,
  /** Sent if the model produced no text at all (e.g. blocked by a safety filter). */
  emptyFallback: string
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let emitted = false;

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Normalize on the accumulated buffer, not the chunk: a "\r\n" can be split across two chunks.
        buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n");
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const text = textFromEvent(buffer.slice(0, sep));
          buffer = buffer.slice(sep + 2);
          if (text) {
            emitted = true;
            controller.enqueue(encoder.encode(text));
          }
        }
      },
      flush(controller) {
        buffer = (buffer + decoder.decode()).replace(/\r\n/g, "\n");
        const text = buffer.trim() ? textFromEvent(buffer) : "";
        if (text) {
          emitted = true;
          controller.enqueue(encoder.encode(text));
        }
        if (!emitted) controller.enqueue(encoder.encode(emptyFallback));
      },
    })
  );
}
