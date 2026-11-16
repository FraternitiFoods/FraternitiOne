import { describe, expect, it } from "vitest";
import { extractDeltaText, geminiSseToTextStream } from "./gemini-sse";

const enc = new TextEncoder();

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += dec.decode(value, { stream: true });
  }
}

const ev = (text: string, extra: object = {}) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text, ...extra }] } }] })}\n\n`;

describe("extractDeltaText", () => {
  it("joins text parts and skips thought parts", () => {
    expect(
      extractDeltaText({
        candidates: [{ content: { parts: [{ text: "secret", thought: true }, { text: "Hel" }, { text: "lo" }] } }],
      })
    ).toBe("Hello");
  });
  it("returns empty for shapes without text (e.g. safety block, usage-only chunk)", () => {
    expect(extractDeltaText({})).toBe("");
    expect(extractDeltaText({ candidates: [{ finishReason: "SAFETY" }] })).toBe("");
    expect(extractDeltaText(null)).toBe("");
  });
});

describe("geminiSseToTextStream", () => {
  it("streams text from events", async () => {
    const out = await readAll(geminiSseToTextStream(bodyOf([ev("Hi "), ev("there")]), "FALLBACK"));
    expect(out).toBe("Hi there");
  });

  it("handles events split across network chunks and CRLF line endings", async () => {
    const full = (ev("Hello ") + ev("world")).replace(/\n/g, "\r\n");
    const mid = Math.floor(full.length / 2);
    const out = await readAll(geminiSseToTextStream(bodyOf([full.slice(0, mid), full.slice(mid)]), "FALLBACK"));
    expect(out).toBe("Hello world");
  });

  it("keeps multi-byte characters intact when a chunk boundary splits them", async () => {
    const bytes = enc.encode(ev("नमस्ते ₹500"));
    const cut = 40; // lands inside a multi-byte sequence
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    });
    expect(await readAll(geminiSseToTextStream(body, "FALLBACK"))).toBe("नमस्ते ₹500");
  });

  it("ignores malformed events but keeps the rest", async () => {
    const out = await readAll(geminiSseToTextStream(bodyOf(["data: {not json\n\n", ev("ok")]), "FALLBACK"));
    expect(out).toBe("ok");
  });

  it("flushes a final event that has no trailing blank line", async () => {
    const out = await readAll(geminiSseToTextStream(bodyOf([ev("a"), ev("b").trimEnd()]), "FALLBACK"));
    expect(out).toBe("ab");
  });

  it("sends the fallback when the model produced no text", async () => {
    const empty = `data: ${JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] })}\n\n`;
    expect(await readAll(geminiSseToTextStream(bodyOf([empty]), "FALLBACK"))).toBe("FALLBACK");
  });
});
