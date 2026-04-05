"""Persistence layer for assistant chat sessions."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock

from supabase import Client

logger = logging.getLogger("snowmind")


@dataclass(frozen=True)
class AssistantStoredMessage:
    """Single assistant chat message persisted by role and timestamp."""

    role: str
    content: str
    created_at: str


@dataclass(frozen=True)
class AssistantSessionSummary:
    """Compact summary used for session list UIs."""

    session_id: str
    title: str
    last_message_at: str


@dataclass(frozen=True)
class AssistantFeedbackEntry:
    """User feedback captured against one assistant response."""

    session_id: str
    assistant_created_at: str
    feedback: str
    message_excerpt: str
    note: str | None
    created_at: str


class AssistantSessionStore:
    """Store and retrieve assistant messages with DB-first persistence.

    Falls back to in-memory session storage when the DB table is unavailable.
    """

    def __init__(self) -> None:
        self._force_memory_only = False
        self._feedback_memory_only = False
        self._memory_lock = Lock()
        self._memory_store: dict[tuple[str, str], list[AssistantStoredMessage]] = {}
        self._memory_feedback_store: dict[str, list[AssistantFeedbackEntry]] = {}

    def append_message(
        self,
        db: Client,
        *,
        privy_user_id: str,
        session_id: str,
        role: str,
        content: str,
    ) -> AssistantStoredMessage:
        """Persist one message and return the stored representation."""
        now_iso = datetime.now(timezone.utc).isoformat()
        fallback = AssistantStoredMessage(role=role, content=content, created_at=now_iso)

        if self._force_memory_only:
            return self._append_in_memory(privy_user_id, session_id, fallback)

        try:
            payload = {
                "privy_user_id": privy_user_id,
                "session_id": session_id,
                "role": role,
                "content": content,
            }
            rows = (
                db.table("assistant_chat_messages")
                .insert(payload)
                .execute()
                .data
            )
            if rows:
                return self._row_to_message(rows[0], fallback=fallback)
            return fallback
        except Exception as exc:
            self._handle_db_error(exc)
            return self._append_in_memory(privy_user_id, session_id, fallback)

    def get_recent_messages(
        self,
        db: Client,
        *,
        privy_user_id: str,
        session_id: str,
        limit: int,
    ) -> list[AssistantStoredMessage]:
        """Read recent chat history in chronological order."""
        safe_limit = max(1, min(limit, 100))

        if self._force_memory_only:
            return self._get_recent_in_memory(privy_user_id, session_id, safe_limit)

        try:
            rows = (
                db.table("assistant_chat_messages")
                .select("role,content,created_at")
                .eq("privy_user_id", privy_user_id)
                .eq("session_id", session_id)
                .order("created_at", desc=True)
                .limit(safe_limit)
                .execute()
                .data
            )
            out = [
                self._row_to_message(
                    row,
                    fallback=AssistantStoredMessage(
                        role=str(row.get("role") or "user"),
                        content=str(row.get("content") or ""),
                        created_at=str(row.get("created_at") or ""),
                    ),
                )
                for row in rows or []
            ]
            out.reverse()
            return out
        except Exception as exc:
            self._handle_db_error(exc)
            return self._get_recent_in_memory(privy_user_id, session_id, safe_limit)

    def list_recent_sessions(
        self,
        db: Client,
        *,
        privy_user_id: str,
        limit: int,
    ) -> list[AssistantSessionSummary]:
        """Return recent sessions ordered by last message timestamp desc."""
        safe_limit = max(1, min(limit, 50))

        if self._force_memory_only:
            return self._list_recent_sessions_in_memory(privy_user_id, safe_limit)

        try:
            # Pull a bounded window of recent rows and summarize by session_id.
            scan_limit = min(max(safe_limit * 40, 200), 2000)
            rows = (
                db.table("assistant_chat_messages")
                .select("session_id,role,content,created_at")
                .eq("privy_user_id", privy_user_id)
                .order("created_at", desc=True)
                .limit(scan_limit)
                .execute()
                .data
            )
            return self._rows_to_session_summaries(rows or [], limit=safe_limit)
        except Exception as exc:
            self._handle_db_error(exc)
            return self._list_recent_sessions_in_memory(privy_user_id, safe_limit)

    def record_feedback(
        self,
        db: Client,
        *,
        privy_user_id: str,
        session_id: str,
        assistant_created_at: str,
        feedback: str,
        message_content: str,
        note: str | None,
    ) -> AssistantFeedbackEntry:
        """Persist one feedback row and return the stored representation."""
        now_iso = datetime.now(timezone.utc).isoformat()
        normalized_note = self._normalize_note(note)
        fallback = AssistantFeedbackEntry(
            session_id=session_id,
            assistant_created_at=assistant_created_at,
            feedback=feedback,
            message_excerpt=self._message_excerpt(message_content),
            note=normalized_note,
            created_at=now_iso,
        )

        if self._feedback_memory_only:
            return self._record_feedback_in_memory(privy_user_id, fallback)

        try:
            payload = {
                "privy_user_id": privy_user_id,
                "session_id": session_id,
                "assistant_created_at": assistant_created_at,
                "feedback_value": feedback,
                "message_excerpt": fallback.message_excerpt,
                "note": normalized_note,
            }
            rows = (
                db.table("assistant_message_feedback")
                .upsert(
                    payload,
                    on_conflict="privy_user_id,session_id,assistant_created_at",
                )
                .execute()
                .data
            )
            if rows:
                return self._row_to_feedback(rows[0], fallback=fallback)
            return fallback
        except Exception as exc:
            self._handle_feedback_error(exc)
            return self._record_feedback_in_memory(privy_user_id, fallback)

    def list_recent_feedback(
        self,
        db: Client,
        *,
        privy_user_id: str,
        limit: int,
    ) -> list[AssistantFeedbackEntry]:
        """Return recent feedback rows for one authenticated user."""
        safe_limit = max(1, min(limit, 20))

        if self._feedback_memory_only:
            return self._list_recent_feedback_in_memory(privy_user_id, safe_limit)

        try:
            rows = (
                db.table("assistant_message_feedback")
                .select(
                    "session_id,assistant_created_at,feedback_value,message_excerpt,note,created_at"
                )
                .eq("privy_user_id", privy_user_id)
                .order("created_at", desc=True)
                .limit(safe_limit)
                .execute()
                .data
            )

            out: list[AssistantFeedbackEntry] = []
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                fallback = AssistantFeedbackEntry(
                    session_id=str(row.get("session_id") or ""),
                    assistant_created_at=str(row.get("assistant_created_at") or ""),
                    feedback=str(row.get("feedback_value") or ""),
                    message_excerpt=str(row.get("message_excerpt") or ""),
                    note=self._normalize_note(row.get("note") if isinstance(row.get("note"), str) else None),
                    created_at=str(row.get("created_at") or datetime.now(timezone.utc).isoformat()),
                )
                out.append(self._row_to_feedback(row, fallback=fallback))

            return out
        except Exception as exc:
            self._handle_feedback_error(exc)
            return self._list_recent_feedback_in_memory(privy_user_id, safe_limit)

    def _append_in_memory(
        self,
        privy_user_id: str,
        session_id: str,
        message: AssistantStoredMessage,
    ) -> AssistantStoredMessage:
        key = (privy_user_id, session_id)
        with self._memory_lock:
            history = self._memory_store.setdefault(key, [])
            history.append(message)
            # Hard cap to avoid unbounded memory growth.
            if len(history) > 200:
                self._memory_store[key] = history[-200:]
        return message

    def _get_recent_in_memory(
        self,
        privy_user_id: str,
        session_id: str,
        limit: int,
    ) -> list[AssistantStoredMessage]:
        key = (privy_user_id, session_id)
        with self._memory_lock:
            history = list(self._memory_store.get(key, []))
        if limit <= 0:
            return []
        return history[-limit:]

    def _list_recent_sessions_in_memory(
        self,
        privy_user_id: str,
        limit: int,
    ) -> list[AssistantSessionSummary]:
        with self._memory_lock:
            matching_items = [
                (session_id, list(history))
                for (user_id, session_id), history in self._memory_store.items()
                if user_id == privy_user_id and history
            ]

        summaries: list[AssistantSessionSummary] = []
        for session_id, history in matching_items:
            last = history[-1]
            title = self._derive_title(history)
            summaries.append(
                AssistantSessionSummary(
                    session_id=session_id,
                    title=title,
                    last_message_at=last.created_at,
                )
            )

        summaries.sort(key=lambda s: self._timestamp_sort_key(s.last_message_at), reverse=True)
        return summaries[:limit]

    def _record_feedback_in_memory(
        self,
        privy_user_id: str,
        entry: AssistantFeedbackEntry,
    ) -> AssistantFeedbackEntry:
        with self._memory_lock:
            rows = list(self._memory_feedback_store.get(privy_user_id, []))
            rows = [
                row
                for row in rows
                if not (
                    row.session_id == entry.session_id
                    and row.assistant_created_at == entry.assistant_created_at
                )
            ]
            rows.insert(0, entry)
            self._memory_feedback_store[privy_user_id] = rows[:200]
        return entry

    def _list_recent_feedback_in_memory(
        self,
        privy_user_id: str,
        limit: int,
    ) -> list[AssistantFeedbackEntry]:
        with self._memory_lock:
            rows = list(self._memory_feedback_store.get(privy_user_id, []))
        return rows[:limit]

    def _rows_to_session_summaries(
        self,
        rows: list[dict],
        *,
        limit: int,
    ) -> list[AssistantSessionSummary]:
        if limit <= 0:
            return []

        ordered_session_ids: list[str] = []
        session_data: dict[str, dict[str, str | bool]] = {}

        for row in rows:
            if not isinstance(row, dict):
                continue

            session_id_raw = row.get("session_id")
            if not isinstance(session_id_raw, str):
                continue
            session_id = session_id_raw.strip()
            if not session_id:
                continue

            role = str(row.get("role") or "")
            content = str(row.get("content") or "")
            created_at = str(row.get("created_at") or datetime.now(timezone.utc).isoformat())

            existing = session_data.get(session_id)
            if existing is None:
                ordered_session_ids.append(session_id)
                session_data[session_id] = {
                    "title": self._title_from_content(content),
                    "last_message_at": created_at,
                    "has_user_title": bool(role == "user" and content.strip()),
                }
                continue

            # Prefer a user-authored message for title when available.
            if role == "user" and content.strip() and not bool(existing.get("has_user_title")):
                existing["title"] = self._title_from_content(content)
                existing["has_user_title"] = True

        out: list[AssistantSessionSummary] = []
        for session_id in ordered_session_ids:
            entry = session_data.get(session_id)
            if entry is None:
                continue
            title = str(entry.get("title") or "New AI chat")
            last_message_at = str(entry.get("last_message_at") or datetime.now(timezone.utc).isoformat())
            out.append(
                AssistantSessionSummary(
                    session_id=session_id,
                    title=title,
                    last_message_at=last_message_at,
                )
            )

            if len(out) >= limit:
                break

        return out

    def _derive_title(self, history: list[AssistantStoredMessage]) -> str:
        for message in history:
            if message.role == "user" and message.content.strip():
                return self._title_from_content(message.content)
        if history:
            return self._title_from_content(history[-1].content)
        return "New AI chat"

    @staticmethod
    def _title_from_content(content: str) -> str:
        normalized = " ".join(content.strip().split())
        if not normalized:
            return "New AI chat"
        if len(normalized) > 56:
            return f"{normalized[:53]}..."
        return normalized

    @staticmethod
    def _timestamp_sort_key(value: str) -> float:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0.0

    def _handle_db_error(self, exc: Exception) -> None:
        if self._is_missing_table_error(exc, "assistant_chat_messages"):
            if not self._force_memory_only:
                logger.warning(
                    "assistant_chat_messages table unavailable; falling back to in-memory chat persistence"
                )
            self._force_memory_only = True
            return

        logger.warning("Assistant chat DB operation failed; using memory fallback for this request: %s", exc)

    def _handle_feedback_error(self, exc: Exception) -> None:
        if self._is_missing_table_error(exc, "assistant_message_feedback"):
            if not self._feedback_memory_only:
                logger.warning(
                    "assistant_message_feedback table unavailable; storing feedback in memory"
                )
            self._feedback_memory_only = True
            return

        logger.warning("Assistant feedback DB operation failed; using memory fallback for this request: %s", exc)

    @staticmethod
    def _is_missing_table_error(exc: Exception, table_name: str) -> bool:
        text = str(exc).lower()
        return (
            table_name in text
            and ("does not exist" in text or "42p01" in text)
        )

    @staticmethod
    def _row_to_message(row: dict, *, fallback: AssistantStoredMessage) -> AssistantStoredMessage:
        if not isinstance(row, dict):
            return fallback

        role = str(row.get("role") or fallback.role)
        content = str(row.get("content") or fallback.content)
        created_at_raw = row.get("created_at")
        created_at = str(created_at_raw) if created_at_raw else fallback.created_at

        return AssistantStoredMessage(role=role, content=content, created_at=created_at)

    @staticmethod
    def _row_to_feedback(row: dict, *, fallback: AssistantFeedbackEntry) -> AssistantFeedbackEntry:
        if not isinstance(row, dict):
            return fallback

        session_id = str(row.get("session_id") or fallback.session_id)
        assistant_created_at = str(row.get("assistant_created_at") or fallback.assistant_created_at)
        feedback = str(row.get("feedback_value") or fallback.feedback)
        message_excerpt = str(row.get("message_excerpt") or fallback.message_excerpt)
        note_raw = row.get("note")
        note = note_raw if isinstance(note_raw, str) else fallback.note
        created_at_raw = row.get("created_at")
        created_at = str(created_at_raw) if created_at_raw else fallback.created_at

        return AssistantFeedbackEntry(
            session_id=session_id,
            assistant_created_at=assistant_created_at,
            feedback=feedback,
            message_excerpt=message_excerpt,
            note=AssistantSessionStore._normalize_note(note),
            created_at=created_at,
        )

    @staticmethod
    def _normalize_note(note: str | None) -> str | None:
        if note is None:
            return None
        normalized = " ".join(note.strip().split())
        if not normalized:
            return None
        if len(normalized) > 600:
            return normalized[:597] + "..."
        return normalized

    @staticmethod
    def _message_excerpt(content: str) -> str:
        normalized = " ".join(content.strip().split())
        if not normalized:
            return "(empty assistant response)"
        if len(normalized) > 220:
            return normalized[:217] + "..."
        return normalized
