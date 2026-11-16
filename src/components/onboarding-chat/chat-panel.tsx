"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, Square, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CHAT_MAX_CHARS, toChatPayload } from "@/lib/onboarding/chat-history";

type Msg = { role: "user" | "model"; text: string; error?: boolean };

const STARTERS = ["What documents do I need?", "What should I do next?", "Who do I contact for help?"];

const NETWORK_ERROR = "I couldn't reach the assistant. Check your connection and try again.";

/**
 * The chat box itself. Lives in its own chunk (loaded with next/dynamic from
 * chat-shell) so it never delays the page's first paint. All streaming state
 * is local here, so tokens arriving never re-render the page around it.
 * Default export so next/dynamic can import it directly.
 */
export default function ChatPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim().slice(0, CHAT_MAX_CHARS);
      if (!question || busy) return;

      const payload = toChatPayload([
        ...messages.filter((m) => !m.error).map(({ role, text }) => ({ role, text })),
        { role: "user" as const, text: question },
      ]);

      setInput("");
      setBusy(true);
      setMessages((prev) => [...prev, { role: "user", text: question }, { role: "model", text: "" }]);

      const controller = new AbortController();
      abortRef.current = controller;

      const patchLast = (fn: (m: Msg) => Msg) =>
        setMessages((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

      // Batch streamed tokens to one state update per animation frame: smooth, and cheap on low-end phones.
      let pending = "";
      let frame = 0;
      const flush = () => {
        frame = 0;
        const chunk = pending;
        pending = "";
        if (chunk) patchLast((m) => ({ ...m, text: m.text + chunk }));
      };

      try {
        const res = await fetch("/api/onboarding-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: payload }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          patchLast(() => ({ role: "model", text: err?.error ?? NETWORK_ERROR, error: true }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          if (!frame) frame = requestAnimationFrame(flush);
        }
        pending += decoder.decode();
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          if (frame) cancelAnimationFrame(frame);
          pending = "";
          patchLast(() => ({ role: "model", text: NETWORK_ERROR, error: true }));
        }
      } finally {
        if (frame) cancelAnimationFrame(frame);
        flush();
        // A stopped/empty reply leaves a blank bubble: remove it.
        setMessages((prev) => (prev.length && prev[prev.length - 1].text === "" ? prev.slice(0, -1) : prev));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages]
  );

  const lastIsEmptyModel = busy && messages.length > 0 && messages[messages.length - 1].text === "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Fraterniti Assistant</div>
          <div className="text-[11px] text-muted-foreground">Powered by Gemini</div>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close assistant">
          <X />
        </Button>
      </div>

      <div ref={listRef} role="log" aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Hi! Ask me anything about your onboarding: documents, status, signing. I reply in English, Hindi or
              Hinglish.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border bg-background px-3 py-1.5 text-xs transition-colors hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                  m.error && "bg-destructive/10 text-destructive"
                )}
              >
                {m.text || (lastIsEmptyModel && i === messages.length - 1 ? <TypingDots /> : null)}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        className="border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            maxLength={CHAT_MAX_CHARS}
            placeholder="Type your question…"
            aria-label="Your question"
            className="max-h-28 min-h-9 flex-1 resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          />
          {busy ? (
            <Button type="button" size="icon-lg" variant="outline" onClick={() => abortRef.current?.abort()} aria-label="Stop">
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon-lg" disabled={!input.trim()} aria-label="Send">
              <Send />
            </Button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Don&apos;t share PAN, Aadhaar or bank details here. Enter them only on the KYC &amp; Documents page.
        </p>
      </form>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
