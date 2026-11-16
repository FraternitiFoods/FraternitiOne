import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GeminiError, streamGeminiReply } from "./gemini";

const args = { system: "sys", messages: [{ role: "user" as const, text: "hi" }] };
const sse = (text: string) =>
  new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`, { status: 200 });

async function read(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

describe("streamGeminiReply", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("503 GeminiError when the key is not configured, without calling Gemini", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(streamGeminiReply(args)).rejects.toMatchObject({ status: 503 });
    expect(f).not.toHaveBeenCalled();
  });

  it("sends the key in a header (never the URL) and streams the text", async () => {
    const f = vi.fn().mockResolvedValue(sse("Hello"));
    vi.stubGlobal("fetch", f);
    expect(await read(await streamGeminiReply(args))).toBe("Hello");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
  });

  it("retries once on a 503 and then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("overloaded", { status: 503 })).mockResolvedValueOnce(sse("ok"));
    vi.stubGlobal("fetch", f);
    expect(await read(await streamGeminiReply(args))).toBe("ok");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("retries once after a network error, then gives up with status 0", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", f);
    await expect(streamGeminiReply(args)).rejects.toMatchObject({ name: "GeminiError", status: 0 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not retry quota (429) or bad requests (400)", async () => {
    for (const status of [429, 400]) {
      const f = vi.fn().mockResolvedValue(new Response("nope", { status }));
      vi.stubGlobal("fetch", f);
      const err = await streamGeminiReply(args).catch((e) => e);
      expect(err).toBeInstanceOf(GeminiError);
      expect(err.status).toBe(status);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("omits thinkingConfig for a non-3.x model set via GEMINI_MODEL", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash-lite");
    const f = vi.fn().mockResolvedValue(sse("x"));
    vi.stubGlobal("fetch", f);
    await read(await streamGeminiReply(args));
    expect(JSON.parse(f.mock.calls[0][1].body).generationConfig.thinkingConfig).toBeUndefined();
  });

  it("does not retry when the browser went away", async () => {
    const ac = new AbortController();
    ac.abort();
    const f = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", f);
    await expect(streamGeminiReply({ ...args, signal: ac.signal })).rejects.toMatchObject({ status: 0 });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
