import { describe, expect, it } from "vitest";
import { CHAT_MAX_MESSAGES, toChatPayload, type ChatTurn } from "./chat-history";
import { chatRequestSchema } from "./chat-prompt";

const u = (text: string): ChatTurn => ({ role: "user", text });
const m = (text: string): ChatTurn => ({ role: "model", text });

describe("toChatPayload", () => {
  it("passes a clean conversation through", () => {
    expect(toChatPayload([u("a"), m("b"), u("c")])).toEqual([u("a"), m("b"), u("c")]);
  });

  it("drops the orphaned question when its answer failed", () => {
    expect(toChatPayload([u("a"), m("b"), u("lost"), u("retry")])).toEqual([u("a"), m("b"), u("retry")]);
  });

  it("never ends on a model turn (the new question is always last)", () => {
    expect(toChatPayload([u("a"), m("b")])).toEqual([u("a")]);
  });

  it("trims to the newest turns and still starts with the user", () => {
    const turns: ChatTurn[] = [];
    for (let i = 0; i < 20; i++) turns.push(i % 2 === 0 ? u(`q${i}`) : m(`a${i}`));
    turns.push(u("last"));
    const out = toChatPayload(turns);
    expect(out.length).toBeLessThanOrEqual(CHAT_MAX_MESSAGES);
    expect(out[0].role).toBe("user");
    expect(out[out.length - 1]).toEqual(u("last"));
  });

  it("always produces something the server schema accepts", () => {
    const messy: ChatTurn[] = [m("x"), u("a"), u("b"), m("c"), m("d"), u("e"), u("f")];
    expect(chatRequestSchema.safeParse({ messages: toChatPayload(messy) }).success).toBe(true);
  });
});
