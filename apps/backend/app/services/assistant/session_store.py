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


class AssistantSessionStore:
    """Store and retrieve assistant messages with DB-first persistence.

    Falls back to in-memory session storage when the DB table is unavailable.
    """

    def __init__(self) -> None:
        self._force_memory_only = False
        self._memory_lock = Lock()
        self._memory_store: dict[tuple[str, str], list[AssistantStoredMessage]] = {}

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

    def _handle_db_error(self, exc: Exception) -> None:
        if self._is_missing_table_error(exc):
            if not self._force_memory_only:
                logger.warning(
                    "assistant_chat_messages table unavailable; falling back to in-memory chat persistence"
                )
            self._force_memory_only = True
            return

        logger.warning("Assistant chat DB operation failed; using memory fallback for this request: %s", exc)

    @staticmethod
    def _is_missing_table_error(exc: Exception) -> bool:
        text = str(exc).lower()
        return (
            "assistant_chat_messages" in text
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
