"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Clock3,
  RotateCcw,
  Copy,
  Compass,
  Loader2,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  WandSparkles,
  X,
} from "lucide-react";
import type { AssistantFeedbackValue, AssistantMessage } from "@snowmind/shared-types";

import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { NeuralSnowflakeLogo } from "@/components/snow/NeuralSnowflake";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, APIError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const SESSION_STORAGE_KEY = "snowmind_assistant_session_id";
const SESSION_INDEX_STORAGE_KEY = "snowmind_assistant_session_index";
const SESSION_LABEL = "Ctrl+J";
const DEFAULT_SESSION_TITLE = "New AI chat";
const MAX_SESSION_ENTRIES = 24;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

interface AssistantSessionSummaryLike {
  sessionId: string;
  title: string;
  lastMessageAt: string;
}

type StoredSessionSummary = AssistantSessionSummaryLike;

const STARTER_PROMPTS: Array<{ kind: "search" | "spark" | "compass" | "wand"; label: string }> = [
  { kind: "spark", label: "Explain today's dynamic risk snapshot." },
  { kind: "search", label: "Why did Silo risk move compared to yesterday?" },
  { kind: "compass", label: "How does static vs dynamic risk scoring work?" },
  { kind: "wand", label: "What does stale risk snapshot mean and how is it handled?" },
];

const QUICK_INSERT_PROMPTS: string[] = [
  "Summarize my latest risk snapshot in 3 bullets.",
  "Compare current risk versus yesterday for all active protocols.",
  "Recommend a safer allocation with minimal APY impact.",
];

function createSessionId(): string {
  if (typeof window !== "undefined") {
    return window.crypto?.randomUUID?.() ?? `session-${Date.now()}`;
  }
  return `session-${Date.now()}`;
}

function normalizeSessionTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return DEFAULT_SESSION_TITLE;
  if (collapsed.length > 56) {
    return `${collapsed.slice(0, 53)}...`;
  }
  return collapsed;
}

function deriveSessionTitleFromMessage(raw: string): string {
  return normalizeSessionTitle(raw);
}

function parseIsoTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortSessionSummariesDesc(
  a: StoredSessionSummary,
  b: StoredSessionSummary,
): number {
  return parseIsoTimestamp(b.lastMessageAt) - parseIsoTimestamp(a.lastMessageAt);
}

function upsertSessionSummary(
  existing: StoredSessionSummary[],
  incoming: StoredSessionSummary,
): StoredSessionSummary[] {
  const normalized: StoredSessionSummary = {
    sessionId: incoming.sessionId,
    title: normalizeSessionTitle(incoming.title),
    lastMessageAt: incoming.lastMessageAt || new Date().toISOString(),
  };

  const withoutCurrent = existing.filter((row) => row.sessionId !== normalized.sessionId);
  return [normalized, ...withoutCurrent]
    .sort(sortSessionSummariesDesc)
    .slice(0, MAX_SESSION_ENTRIES);
}

function mergeSessionSummaries(
  current: StoredSessionSummary[],
  incoming: StoredSessionSummary[],
): StoredSessionSummary[] {
  return incoming.reduce((acc, row) => upsertSessionSummary(acc, row), current);
}

function readStoredSessionSummaries(raw: string | null): StoredSessionSummary[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const cleaned = parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;

        const maybe = row as Partial<StoredSessionSummary>;
        const sessionId = typeof maybe.sessionId === "string" ? maybe.sessionId.trim() : "";
        const title = typeof maybe.title === "string" ? maybe.title : DEFAULT_SESSION_TITLE;
        const lastMessageAt = typeof maybe.lastMessageAt === "string" ? maybe.lastMessageAt : "";

        if (!SESSION_ID_RE.test(sessionId)) return null;
        return {
          sessionId,
          title: normalizeSessionTitle(title),
          lastMessageAt: lastMessageAt || new Date().toISOString(),
        };
      })
      .filter((row): row is StoredSessionSummary => row !== null)
      .sort(sortSessionSummariesDesc)
      .slice(0, MAX_SESSION_ENTRIES);

    return cleaned;
  } catch {
    return [];
  }
}

function toStoredSessionSummary(summary: AssistantSessionSummaryLike): StoredSessionSummary | null {
  const sessionId = summary.sessionId?.trim();
  if (!SESSION_ID_RE.test(sessionId)) return null;

  return {
    sessionId,
    title: normalizeSessionTitle(summary.title),
    lastMessageAt: summary.lastMessageAt || new Date().toISOString(),
  };
}

function formatSessionTimestamp(value: string): string {
  const parsed = parseIsoTimestamp(value);
  if (!parsed) return "";

  const date = new Date(parsed);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function splitSessionsByDay(sessions: StoredSessionSummary[]): {
  today: StoredSessionSummary[];
  older: StoredSessionSummary[];
} {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const threshold = startOfToday.getTime();

  const today: StoredSessionSummary[] = [];
  const older: StoredSessionSummary[] = [];

  for (const row of sessions) {
    if (parseIsoTimestamp(row.lastMessageAt) >= threshold) {
      today.push(row);
    } else {
      older.push(row);
    }
  }

  return { today, older };
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
  const [sessions, setSessions] = useState<StoredSessionSummary[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [feedbackByMessageKey, setFeedbackByMessageKey] = useState<Record<string, AssistantFeedbackValue>>({});
  const [pendingFeedbackKey, setPendingFeedbackKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingSessionList, setIsLoadingSessionList] = useState(false);
  const [sessionFetchVersion, setSessionFetchVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const activeSessionTitle = useMemo(() => {
    if (!sessionId) return DEFAULT_SESSION_TITLE;
    return sessions.find((row) => row.sessionId === sessionId)?.title ?? DEFAULT_SESSION_TITLE;
  }, [sessionId, sessions]);

  const sessionGroups = useMemo(() => splitSessionsByDay(sessions), [sessions]);

  const latestAssistantIndex = useMemo(() => {
    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      if (messages[idx]?.role === "assistant") {
        return idx;
      }
    }
    return -1;
  }, [messages]);

  const upsertSession = useCallback((summary: StoredSessionSummary) => {
    setSessions((prev) => upsertSessionSummary(prev, summary));
  }, []);

  const activateSession = useCallback(
    (nextSessionId: string, title = DEFAULT_SESSION_TITLE, lastMessageAt = new Date().toISOString()) => {
      const normalizedSessionId = SESSION_ID_RE.test(nextSessionId) ? nextSessionId : createSessionId();

      setSessionId(normalizedSessionId);
      upsertSession({
        sessionId: normalizedSessionId,
        title,
        lastMessageAt,
      });

      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, normalizedSessionId);
      }
    },
    [upsertSession],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const persistedSessions = readStoredSessionSummaries(
      window.localStorage.getItem(SESSION_INDEX_STORAGE_KEY),
    );

    let existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!existing || !SESSION_ID_RE.test(existing)) {
      existing = createSessionId();
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, existing);
    }

    setSessions(
      upsertSessionSummary(persistedSessions, {
        sessionId: existing,
        title: DEFAULT_SESSION_TITLE,
        lastMessageAt: new Date().toISOString(),
      }),
    );
    setSessionId(existing);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SESSION_INDEX_STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    setFeedbackByMessageKey({});
    setPendingFeedbackKey(null);
  }, [sessionId]);

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
    if (!isOpen) return;

    let cancelled = false;
    setIsLoadingSessionList(true);

    void api
      .getAssistantSessions(MAX_SESSION_ENTRIES)
      .then((response) => {
        if (cancelled) return;
        const normalized = response.sessions
          .map((row: AssistantSessionSummaryLike) => toStoredSessionSummary(row))
          .filter((row): row is StoredSessionSummary => row !== null);
        setSessions((prev) => mergeSessionSummaries(prev, normalized));
      })
      .catch(() => {
        if (cancelled) return;
        // Silent fallback to local history index when remote list fetch fails.
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSessionList(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

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

        const firstUserMessage = response.messages.find((message) => message.role === "user");
        const title = firstUserMessage
          ? deriveSessionTitleFromMessage(firstUserMessage.content)
          : DEFAULT_SESSION_TITLE;
        const lastMessageAt =
          response.messages[response.messages.length - 1]?.createdAt
          ?? new Date().toISOString();

        upsertSession({
          sessionId: response.sessionId,
          title,
          lastMessageAt,
        });
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
  }, [isOpen, sessionId, sessionFetchVersion, upsertSession]);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 2400);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [isOpen, messages, isSending]);

  const submitMessage = async (rawMessage?: string) => {
    const currentSessionId = sessionId;
    const nextMessage = (rawMessage ?? input).trim();
    if (!nextMessage || !currentSessionId || isSending || isLoadingHistory) return;

    setError(null);
    setNotice(null);
    setInput("");
    setIsSending(true);
    setMessages((prev) => [...prev, makeMessage("user", nextMessage)]);

    const existingTitle = sessions.find((row) => row.sessionId === currentSessionId)?.title;
    const suggestedTitle = deriveSessionTitleFromMessage(nextMessage);
    const resolvedTitle =
      existingTitle && existingTitle !== DEFAULT_SESSION_TITLE
        ? existingTitle
        : suggestedTitle;

    upsertSession({
      sessionId: currentSessionId,
      title: resolvedTitle,
      lastMessageAt: new Date().toISOString(),
    });

    try {
      const response = await api.chatAssistant({
        sessionId: currentSessionId,
        message: nextMessage,
      });

      const lastMessageAt =
        response.messages[response.messages.length - 1]?.createdAt
        ?? new Date().toISOString();

      if (response.sessionId !== currentSessionId) {
        activateSession(response.sessionId, resolvedTitle, lastMessageAt);
      } else {
        upsertSession({
          sessionId: response.sessionId,
          title: resolvedTitle,
          lastMessageAt,
        });
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
    activateSession(nextSessionId, DEFAULT_SESSION_TITLE, new Date().toISOString());
    setMessages([]);
    setInput("");
    setError(null);
    setNotice("Started a new conversation.");
  };

  const openStoredSession = (nextSessionId: string) => {
    if (!SESSION_ID_RE.test(nextSessionId)) return;

    const knownSession = sessions.find((row) => row.sessionId === nextSessionId);
    const nextTitle = knownSession?.title ?? DEFAULT_SESSION_TITLE;

    setError(null);
    setNotice(null);
    setMessages([]);
    setInput("");
    activateSession(nextSessionId, nextTitle, knownSession?.lastMessageAt ?? new Date().toISOString());
  };

  const insertPrompt = (prompt: string) => {
    setInput(prompt);
    setNotice("Prompt inserted.");
    composerRef.current?.focus();
    const offset = prompt.length;
    composerRef.current?.setSelectionRange(offset, offset);
  };

  const copyCurrentSessionId = async () => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setNotice("Session id copied.");
    } catch {
      setError("Could not copy session id.");
    }
  };

  const copyLatestAssistantReply = async () => {
    const latestReply = [...messages].reverse().find((message) => message.role === "assistant");
    if (!latestReply) {
      setNotice("No assistant reply to copy yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(latestReply.content);
      setNotice("Latest assistant reply copied.");
    } catch {
      setError("Could not copy assistant reply.");
    }
  };

  const copyMessageContent = async (content: string) => {
    const normalized = content.trim();
    if (!normalized) {
      setNotice("Nothing to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(normalized);
      setNotice("Response copied.");
    } catch {
      setError("Could not copy response.");
    }
  };

  const insertAssistantReplyIntoComposer = (content: string) => {
    const normalized = content.trim();
    if (!normalized) {
      setNotice("Nothing to insert.");
      return;
    }

    const snippet = normalized.length > 700 ? `${normalized.slice(0, 697)}...` : normalized;
    setInput((prev) => {
      if (!prev.trim()) {
        return `Use this as context and continue:\n${snippet}`;
      }
      return `${prev}\n\n${snippet}`;
    });
    setNotice("Response inserted into composer.");

    composerRef.current?.focus();
  };

  const submitAssistantFeedback = async (
    message: AssistantMessage,
    index: number,
    feedback: AssistantFeedbackValue,
  ) => {
    if (!sessionId || message.role !== "assistant") return;

    const createdAt = message.createdAt?.trim();
    if (!createdAt) {
      setError("Cannot save feedback for this response.");
      return;
    }

    const messageKey = `${createdAt}:${index}:${message.role}`;
    setPendingFeedbackKey(messageKey);
    setError(null);

    try {
      await api.submitAssistantFeedback({
        sessionId,
        messageCreatedAt: createdAt,
        messageContent: message.content,
        feedback,
      });

      setFeedbackByMessageKey((prev) => ({
        ...prev,
        [messageKey]: feedback,
      }));
      setNotice(feedback === "up" ? "Marked as helpful." : "Marked as not helpful.");
    } catch (err) {
      if (err instanceof APIError) {
        setError(err.message);
      } else {
        setError("Could not save feedback right now.");
      }
    } finally {
      setPendingFeedbackKey(null);
    }
  };

  const regenerateLatestAssistantReply = async () => {
    if (isSending || isLoadingHistory) return;

    const latestUserPrompt = [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content
      .trim();

    if (!latestUserPrompt) {
      setNotice("No prior user prompt found to regenerate.");
      return;
    }

    setIsRegenerating(true);
    try {
      await submitMessage(latestUserPrompt);
      setNotice("Regenerated latest response.");
    } finally {
      setIsRegenerating(false);
    }
  };

  const refreshCurrentSession = () => {
    if (!sessionId) return;
    setSessionFetchVersion((prev) => prev + 1);
    setNotice("Session refreshed.");
  };

  const messageActionButtonClass =
    "inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/12 bg-white/[0.03] text-white/60 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <>
      {isOpen && (
        <div
          className="fixed bottom-[78px] right-4 z-40 h-[min(70vh,520px)] w-[min(88vw,338px)] overflow-hidden rounded-[22px] border border-white/10 text-white shadow-[0_20px_55px_rgba(0,0,0,0.42)] backdrop-blur-md sm:right-6"
          style={{
            background:
              "radial-gradient(120% 120% at 100% 0%, rgba(232,65,66,0.14) 0%, rgba(232,65,66,0) 58%), linear-gradient(180deg, #171A20 0%, #111318 100%)",
          }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/8 ring-1 ring-white/15">
                <NeuralSnowflakeLogo className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex max-w-[185px] items-center gap-1 rounded-md px-1 py-0.5 text-left text-[13px] font-medium text-white/95 transition hover:bg-white/10"
                      aria-label="Open session history"
                    >
                      <span className="truncate">{activeSessionTitle}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-white/60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    sideOffset={10}
                    className="w-[280px] rounded-xl border border-white/12 bg-[#151920] p-1.5 text-white shadow-[0_16px_48px_rgba(0,0,0,0.45)]"
                  >
                    <DropdownMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white/45">
                      Conversations
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem
                      onSelect={startFreshConversation}
                      className="rounded-md px-2 py-1.5 text-[12px] text-white/90 focus:bg-white/10 focus:text-white"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New conversation
                    </DropdownMenuItem>
                    {isLoadingSessionList ? (
                      <DropdownMenuItem
                        disabled
                        className="rounded-md px-2 py-1.5 text-[12px] text-white/60"
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Syncing sessions...
                      </DropdownMenuItem>
                    ) : null}

                    {sessionGroups.today.length > 0 ? (
                      <>
                        <DropdownMenuSeparator className="bg-white/10" />
                        <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-[0.14em] text-white/45">
                          Today
                        </DropdownMenuLabel>
                        {sessionGroups.today.map((row) => (
                          <DropdownMenuItem
                            key={row.sessionId}
                            onSelect={() => openStoredSession(row.sessionId)}
                            className="rounded-md px-2 py-1.5 text-[12px] text-white/90 focus:bg-white/10 focus:text-white"
                          >
                            <span className="truncate">{row.title}</span>
                            <span className="ml-auto text-[10px] text-white/45">
                              {formatSessionTimestamp(row.lastMessageAt)}
                            </span>
                            {row.sessionId === sessionId ? (
                              <Check className="h-3.5 w-3.5 text-[#F15C5D]" />
                            ) : (
                              <Clock3 className="h-3 w-3 text-white/35" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </>
                    ) : null}

                    {sessionGroups.older.length > 0 ? (
                      <>
                        <DropdownMenuSeparator className="bg-white/10" />
                        <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-[0.14em] text-white/45">
                          Older
                        </DropdownMenuLabel>
                        {sessionGroups.older.map((row) => (
                          <DropdownMenuItem
                            key={row.sessionId}
                            onSelect={() => openStoredSession(row.sessionId)}
                            className="rounded-md px-2 py-1.5 text-[12px] text-white/90 focus:bg-white/10 focus:text-white"
                          >
                            <span className="truncate">{row.title}</span>
                            <span className="ml-auto text-[10px] text-white/45">
                              {formatSessionTimestamp(row.lastMessageAt)}
                            </span>
                            {row.sessionId === sessionId ? (
                              <Check className="h-3.5 w-3.5 text-[#F15C5D]" />
                            ) : (
                              <Clock3 className="h-3 w-3 text-white/35" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
                <p className="text-[10px] text-white/45">Grounded on report.md + riskscoreplan.md</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={startFreshConversation}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white"
                aria-label="Start new assistant conversation"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white"
                aria-label="Close assistant"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex h-[calc(100%-61px)] flex-col overflow-hidden">
            <div className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3">
              {isLoadingHistory ? (
                <div className="flex items-center gap-2 text-[11px] text-white/65">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading session context...
                </div>
              ) : null}

              {!isLoadingHistory && messages.length === 0 ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(232,65,66,0.12)_0%,rgba(255,255,255,0.02)_68%)] p-3.5">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#121316]">
                        <NeuralSnowflakeLogo className="h-5 w-5" />
                      </span>
                    </div>
                    <p className="mt-2.5 text-[22px] font-semibold leading-[1.15] tracking-tight text-white/95">
                      What should we optimize today?
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {STARTER_PROMPTS.map((prompt) => (
                      <button
                        key={prompt.label}
                        type="button"
                        onClick={() => {
                          void submitMessage(prompt.label);
                        }}
                        disabled={isLoadingHistory || isSending}
                        className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-left text-[12px] text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-50"
                      >
                        {renderStarterIcon(prompt.kind)}
                        <span>{prompt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages.map((message, idx) => {
                const isAssistant = message.role === "assistant";
                const itemKey = `${message.createdAt}:${idx}:${message.role}`;
                const feedback = feedbackByMessageKey[itemKey];
                const isFeedbackPending = pendingFeedbackKey === itemKey;
                const isLatestAssistant = isAssistant && idx === latestAssistantIndex;
                const canRegenerate = isLatestAssistant && !isSending && !isLoadingHistory;

                return (
                  <div
                    key={itemKey}
                    className={cn("max-w-[90%]", isAssistant ? "mr-auto" : "ml-auto")}
                  >
                    <div
                      className={cn(
                        "rounded-xl px-3 py-2 text-[12px] leading-[1.45]",
                        !isAssistant
                          ? "rounded-br-md bg-[linear-gradient(135deg,#E84142_0%,#D83A3B_100%)] text-white shadow-[0_6px_18px_rgba(232,65,66,0.22)]"
                          : "rounded-bl-md border border-white/10 bg-white/[0.04] text-white/90",
                      )}
                    >
                      {isAssistant ? (
                        <AssistantMarkdown content={message.content} />
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>

                    {isAssistant ? (
                      <div className="mt-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            void copyMessageContent(message.content);
                          }}
                          className={messageActionButtonClass}
                          aria-label="Copy response"
                          disabled={isFeedbackPending}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => insertAssistantReplyIntoComposer(message.content)}
                          className={messageActionButtonClass}
                          aria-label="Insert response into composer"
                          disabled={isFeedbackPending}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            void regenerateLatestAssistantReply();
                          }}
                          className={messageActionButtonClass}
                          aria-label="Regenerate latest response"
                          disabled={!canRegenerate || isRegenerating}
                        >
                          {isRegenerating && isLatestAssistant ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            void submitAssistantFeedback(message, idx, "up");
                          }}
                          className={cn(
                            messageActionButtonClass,
                            feedback === "up"
                              ? "border-[#65D48E]/45 bg-[#65D48E]/10 text-[#A9F0C2]"
                              : "",
                          )}
                          aria-label="Mark response helpful"
                          disabled={isFeedbackPending || !sessionId || isSending || isLoadingHistory}
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            void submitAssistantFeedback(message, idx, "down");
                          }}
                          className={cn(
                            messageActionButtonClass,
                            feedback === "down"
                              ? "border-[#F28A8B]/45 bg-[#F28A8B]/10 text-[#FFD0D0]"
                              : "",
                          )}
                          aria-label="Mark response not helpful"
                          disabled={isFeedbackPending || !sessionId || isSending || isLoadingHistory}
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {isSending ? (
                <div className="mr-auto inline-flex items-center gap-2 rounded-xl rounded-bl-md border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/70">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {isRegenerating ? "Regenerating response..." : "Thinking with Gemini..."}
                </div>
              ) : null}

              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-white/10 bg-[#101217]/90 px-2.5 pb-2.5 pt-2">
              <div className="mb-1.5 inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[9px] font-medium text-white/60">
                <Sparkles className="h-3 w-3" />
                Grounded context enabled
              </div>
              {notice ? <p className="mb-1 text-[10px] text-white/55">{notice}</p> : null}
              {error ? <p className="mb-1 text-[10px] text-[#FF9B9C]">{error}</p> : null}
              <div className="rounded-xl border border-white/12 bg-[#1B1D24] px-2 py-1.5">
                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitMessage();
                    }
                  }}
                  placeholder="Do anything with AI..."
                  className="min-h-[44px] max-h-28 w-full resize-none bg-transparent px-1 py-1 text-[13px] text-white outline-none placeholder:text-white/35"
                />
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition hover:bg-white/10 hover:text-white"
                          aria-label="Insert action"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        side="top"
                        align="start"
                        sideOffset={8}
                        className="w-[260px] rounded-xl border border-white/12 bg-[#151920] p-1.5 text-white"
                      >
                        <DropdownMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white/45">
                          Insert Prompt
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-white/10" />
                        {QUICK_INSERT_PROMPTS.map((prompt) => (
                          <DropdownMenuItem
                            key={prompt}
                            onSelect={() => insertPrompt(prompt)}
                            className="rounded-md px-2 py-1.5 text-[12px] text-white/90 focus:bg-white/10 focus:text-white"
                          >
                            <span className="whitespace-normal">{prompt}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition hover:bg-white/10 hover:text-white"
                          aria-label="Assistant settings"
                        >
                          <Settings2 className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        side="top"
                        align="start"
                        sideOffset={8}
                        className="w-[230px] rounded-xl border border-white/12 bg-[#151920] p-1.5 text-white"
                      >
                        <DropdownMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white/45">
                          Assistant Actions
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-white/10" />
                        <DropdownMenuItem
                          onSelect={refreshCurrentSession}
                          className="rounded-md px-2 py-1.5 text-[12px] text-white/90 focus:bg-white/10 focus:text-white"
                        >
                          <Loader2 className="h-3.5 w-3.5" />
                          Refresh current session
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            void copyCurrentSessionId();
                          }}
                          className="rounded-md px-2 py-1.5 text-[12px] text-white/90 focus:bg-white/10 focus:text-white"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy session id
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            void copyLatestAssistantReply();
                          }}
                          className="rounded-md px-2 py-1.5 text-[12px] text-white/90 focus:bg-white/10 focus:text-white"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy latest reply
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-white/10" />
                        <DropdownMenuItem
                          onSelect={startFreshConversation}
                          className="rounded-md px-2 py-1.5 text-[12px] text-white/90 focus:bg-white/10 focus:text-white"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Start new conversation
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-white/45">Auto</span>
                    <button
                      type="button"
                      onClick={() => {
                        void submitMessage();
                      }}
                      disabled={!input.trim() || isSending || isLoadingHistory || !sessionId}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label="Send message"
                    >
                      <Send className="h-3.5 w-3.5" />
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
        className="group fixed bottom-5 right-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-[18px] border border-[#F15C5D]/30 text-white shadow-[0_12px_28px_rgba(16,17,22,0.42)] transition hover:-translate-y-0.5 hover:border-[#F15C5D]/55 sm:right-6"
        style={{
          background:
            "radial-gradient(120% 120% at 90% 100%, rgba(232,65,66,0.34) 0%, rgba(232,65,66,0) 58%), linear-gradient(160deg, #1F2229 0%, #12141A 100%)",
        }}
        aria-label={isOpen ? "Close SnowMind assistant" : "Open SnowMind assistant"}
      >
        {isOpen ? (
          <X className="h-4 w-4" />
        ) : (
          <NeuralSnowflakeLogo className="h-[22px] w-[22px] animate-[spin_5.8s_linear_infinite]" />
        )}
        <span
          className={cn(
            "pointer-events-none absolute -left-[178px] top-1/2 hidden -translate-y-1/2 items-center gap-2 rounded-full border border-white/10 bg-[#191B20] px-3 py-1 text-[10px] text-white/80 shadow-lg transition-all duration-200 md:inline-flex",
            isOpen
              ? "opacity-0"
              : "translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100",
          )}
        >
          Hi, it&apos;s SnowMind AI
          <span className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60">{SESSION_LABEL}</span>
        </span>
      </button>
    </>
  );
}
