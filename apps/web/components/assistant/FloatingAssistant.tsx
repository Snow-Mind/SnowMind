"use client";

import { useEffect, useRef, useState } from "react";
import {
  Compass,
  Loader2,
  MessageSquareText,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import type { AssistantMessage } from "@snowmind/shared-types";

import { NeuralSnowflakeLogo } from "@/components/snow/NeuralSnowflake";
import { api, APIError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const SESSION_STORAGE_KEY = "snowmind_assistant_session_id";
const SESSION_LABEL = "Ctrl+J";

const STARTER_PROMPTS: Array<{ kind: "search" | "spark" | "compass" | "wand"; label: string }> = [
  { kind: "spark", label: "Explain today's dynamic risk snapshot." },
  { kind: "search", label: "Why did Silo risk move compared to yesterday?" },
  { kind: "compass", label: "How does static vs dynamic risk scoring work?" },
  { kind: "wand", label: "What does stale risk snapshot mean and how is it handled?" },
];

function createSessionId(): string {
  if (typeof window !== "undefined") {
    return window.crypto?.randomUUID?.() ?? `session-${Date.now()}`;
  }
  return `session-${Date.now()}`;
}

function renderStarterIcon(kind: "search" | "spark" | "compass" | "wand") {
  const cls = "h-3.5 w-3.5 text-[#A4A4AA]";
  if (kind === "search") return <Search className={cls} />;
  if (kind === "spark") return <Sparkles className={cls} />;
  if (kind === "compass") return <Compass className={cls} />;
  return <WandSparkles className={cls} />;
}

function makeMessage(role: "user" | "assistant", content: string): AssistantMessage {
  return {
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export function FloatingAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!existing) {
      existing = createSessionId();
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, existing);
    }
    setSessionId(existing);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!isOpen || !sessionId) return;

    let cancelled = false;
    setIsLoadingHistory(true);
    setError(null);

    void api
      .getAssistantSession(sessionId)
      .then((response) => {
        if (cancelled) return;
        setMessages(response.messages);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof APIError && err.status === 401) {
          setError("Sign in again to use the assistant.");
          return;
        }
        setError("Unable to load previous messages.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionId]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [isOpen, messages, isSending]);

  const submitMessage = async (rawMessage?: string) => {
    const nextMessage = (rawMessage ?? input).trim();
    if (!nextMessage || !sessionId || isSending || isLoadingHistory) return;

    setError(null);
    setInput("");
    setIsSending(true);
    setMessages((prev) => [...prev, makeMessage("user", nextMessage)]);

    try {
      const response = await api.chatAssistant({
        sessionId,
        message: nextMessage,
      });

      if (response.sessionId !== sessionId) {
        setSessionId(response.sessionId);
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, response.sessionId);
        }
      }

      setMessages(response.messages);
    } catch (err) {
      let reason = "Assistant is temporarily unavailable.";
      if (err instanceof APIError) {
        reason = err.message;
      }
      setError(reason);
      setMessages((prev) => [
        ...prev,
        makeMessage("assistant", `I could not complete that request: ${reason}`),
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const startFreshConversation = () => {
    const nextSessionId = createSessionId();
    setSessionId(nextSessionId);
    setMessages([]);
    setInput("");
    setError(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
    }
  };

  return (
    <>
      {isOpen && (
        <div className="fixed bottom-24 right-4 z-40 h-[580px] w-[min(92vw,390px)] overflow-hidden rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,#1D1F24_0%,#15161A_100%)] text-white shadow-[0_30px_80px_rgba(0,0,0,0.45)] sm:right-6">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/8 ring-1 ring-white/15">
                <NeuralSnowflakeLogo className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white/95">New AI chat</p>
                <p className="text-[10px] text-white/45">Grounded on report.md + riskscoreplan.md</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={startFreshConversation}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white"
                aria-label="Start new assistant conversation"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white"
                aria-label="Close assistant"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex h-[calc(100%-69px)] flex-col overflow-hidden">
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {isLoadingHistory ? (
                <div className="flex items-center gap-2 text-xs text-white/65">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading session context...
                </div>
              ) : null}

              {!isLoadingHistory && messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(232,65,66,0.16)_0%,_rgba(255,255,255,0.02)_65%)] p-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#121316]">
                        <NeuralSnowflakeLogo className="h-5 w-5" />
                      </span>
                    </div>
                    <p className="mt-3 text-2xl font-semibold tracking-tight text-white/95">What should we optimize today?</p>
                  </div>
                  <div className="space-y-2">
                    {STARTER_PROMPTS.map((prompt) => (
                      <button
                        key={prompt.label}
                        type="button"
                        onClick={() => {
                          void submitMessage(prompt.label);
                        }}
                        disabled={isLoadingHistory || isSending}
                        className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-50"
                      >
                        {renderStarterIcon(prompt.kind)}
                        <span>{prompt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages.map((message, idx) => (
                <div
                  key={`${message.createdAt}-${idx}`}
                  className={cn(
                    "max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    message.role === "user"
                      ? "ml-auto rounded-br-md bg-[linear-gradient(135deg,#E84142_0%,#CF2F30_100%)] text-white shadow-[0_8px_24px_rgba(232,65,66,0.35)]"
                      : "mr-auto rounded-bl-md border border-white/10 bg-white/[0.04] text-white/90",
                  )}
                >
                  {message.content}
                </div>
              ))}

              {isSending ? (
                <div className="mr-auto inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Thinking with Gemini...
                </div>
              ) : null}

              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-white/10 bg-black/25 px-3 pb-3 pt-2.5">
              <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-medium text-white/60">
                <Sparkles className="h-3 w-3" />
                Grounded context enabled
              </div>
              {error ? <p className="mb-2 text-[11px] text-[#FF9B9C]">{error}</p> : null}
              <div className="rounded-2xl border border-white/12 bg-[#1C1D22] px-2.5 py-2">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitMessage();
                    }
                  }}
                  placeholder="Do anything with AI..."
                  className="min-h-[52px] max-h-32 w-full resize-none bg-transparent px-1 py-1 text-sm text-white outline-none placeholder:text-white/35"
                />
                <div className="mt-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition hover:bg-white/10 hover:text-white"
                      aria-label="Insert action"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition hover:bg-white/10 hover:text-white"
                      aria-label="Assistant settings"
                    >
                      <Settings2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white/45">Auto</span>
                    <button
                      type="button"
                      onClick={() => {
                        void submitMessage();
                      }}
                      disabled={!input.trim() || isSending || isLoadingHistory || !sessionId}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label="Send message"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-6 right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[#F15C5D]/35 bg-[linear-gradient(145deg,#26282E_0%,#15161A_55%,#E84142_220%)] text-white shadow-[0_18px_34px_rgba(18,19,24,0.45)] transition hover:-translate-y-0.5 hover:border-[#F15C5D]/60 sm:right-6"
        aria-label={isOpen ? "Close SnowMind assistant" : "Open SnowMind assistant"}
      >
        {isOpen ? <X className="h-5 w-5" /> : <MessageSquareText className="h-5 w-5" />}
        <span className="absolute -left-[194px] top-1/2 hidden -translate-y-1/2 items-center gap-2 rounded-full border border-white/10 bg-[#191B20] px-3 py-1.5 text-[11px] text-white/80 shadow-lg md:inline-flex">
          Hi, it&apos;s SnowMind AI
          <span className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60">{SESSION_LABEL}</span>
        </span>
      </button>
    </>
  );
}
