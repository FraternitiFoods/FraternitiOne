import { describe, expect, it } from "vitest";
import { CHAT_MAX_CHARS, CHAT_MAX_MESSAGES, buildSystemPrompt, chatRequestSchema, type ChatContext } from "./chat-prompt";
import { createRateLimiter } from "./chat-rate-limit";
import { isValidYoutubeId } from "./welcome-videos";

const ctx: ChatContext = {
  name: "Asha Verma",
  seq: 7,
  brand: "Tulsi",
  proposedLocation: "Indore",
  entityType: "INDIVIDUAL",
  onboardingStatus: "CORRECTIONS_REQUESTED",
  kycStatus: "CHANGES_REQUESTED",
  paymentStatus: "ACCEPTED",
  expectedAmount: 250000_00,
  salesOwner: { name: "Ravi Kumar", email: "ravi@example.com" },
};

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(ctx);

  it("includes only this franchisee's own safe details", () => {
    expect(prompt).toContain("Asha Verma");
    expect(prompt).toContain("F1-0007");
    expect(prompt).toContain("Corrections Requested");
    expect(prompt).toContain("₹2,50,000");
    expect(prompt).toContain("Ravi Kumar (ravi@example.com)");
  });

  it("carries the guard-rail rules", () => {
    expect(prompt).toMatch(/Answer ONLY from/);
    expect(prompt).toMatch(/Never ask for, accept or repeat PAN, Aadhaar/);
    expect(prompt).toMatch(/Sales contact/);
  });

  it("states the right required documents for the entity type in the knowledge", () => {
    expect(prompt).toContain("Certificate of incorporation");
  });
});

describe("chatRequestSchema", () => {
  const ok = { messages: [{ role: "user", text: "What documents do I need?" }] };

  it("accepts a normal single question", () => {
    expect(chatRequestSchema.safeParse(ok).success).toBe(true);
  });

  it("accepts an alternating conversation ending with the user", () => {
    const r = chatRequestSchema.safeParse({
      messages: [
        { role: "user", text: "hi" },
        { role: "model", text: "hello" },
        { role: "user", text: "next?" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects bad shapes", () => {
    const bad: unknown[] = [
      null,
      {},
      { messages: [] },
      { messages: [{ role: "model", text: "x" }] }, // must start with user
      { messages: [{ role: "user", text: "a" }, { role: "model", text: "b" }] }, // must end with user
      { messages: [{ role: "user", text: "a" }, { role: "user", text: "b" }] }, // must alternate
      { messages: [{ role: "system", text: "a" }] },
      { messages: [{ role: "user", text: "   " }] },
      { messages: [{ role: "user", text: "x".repeat(CHAT_MAX_CHARS + 1) }] },
    ];
    for (const b of bad) expect(chatRequestSchema.safeParse(b).success, JSON.stringify(b)?.slice(0, 60)).toBe(false);
  });

  it("caps history length", () => {
    const many = Array.from({ length: CHAT_MAX_MESSAGES + 1 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "model",
      text: "x",
    }));
    expect(chatRequestSchema.safeParse({ messages: many }).success).toBe(false);
  });
});

describe("createRateLimiter", () => {
  it("allows up to the limit inside the window, then blocks, then recovers", () => {
    const rl = createRateLimiter(3, 1000);
    expect([0, 1, 2].map((t) => rl.check("u", t))).toEqual([true, true, true]);
    expect(rl.check("u", 500)).toBe(false);
    expect(rl.check("other", 500)).toBe(true); // keys are independent
    expect(rl.check("u", 1001)).toBe(true); // window slid past the first hits
  });
});

describe("isValidYoutubeId", () => {
  it("accepts real-looking ids and rejects junk", () => {
    expect(isValidYoutubeId("dQw4w9WgXcQ")).toBe(true);
    expect(isValidYoutubeId(null)).toBe(false);
    expect(isValidYoutubeId("short")).toBe(false);
    expect(isValidYoutubeId("dQw4w9WgXcQ/../x")).toBe(false);
    expect(isValidYoutubeId('"><script>1')).toBe(false);
  });
});
