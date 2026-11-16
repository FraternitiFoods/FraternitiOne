/**
 * Chat limits + the "what do we send to the server" rule, shared by the client
 * chat box and the server validation. Deliberately dependency-free (no zod, no
 * knowledge doc) so importing it into the browser bundle costs nothing.
 */
export const CHAT_MAX_MESSAGES = 12;
export const CHAT_MAX_CHARS = 1000;

export type ChatTurn = { role: "user" | "model"; text: string };

/**
 * Turns the on-screen conversation into a payload the server will accept:
 * starts and ends with the user, strictly alternating, newest turns only.
 * A question whose answer failed leaves two user turns in a row on screen; the
 * older orphan is dropped rather than rejected by the server.
 */
export function toChatPayload(turns: readonly ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) {
      if (t.role === "user") out[out.length - 1] = t; // keep the newest question
      continue; // two model turns in a row: keep the first
    }
    out.push(t);
  }
  while (out.length > CHAT_MAX_MESSAGES) out.shift();
  while (out.length > 0 && out[0].role !== "user") out.shift();
  while (out.length > 0 && out[out.length - 1].role !== "user") out.pop();
  return out;
}
