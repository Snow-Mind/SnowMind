from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request

from app.api.routes import assistant as assistant_routes
from app.services.assistant.session_store import (
    AssistantFeedbackEntry,
    AssistantSessionSummary,
    AssistantStoredMessage,
)


class _FakeSessionStore:
    def __init__(self) -> None:
        self._messages: dict[tuple[str, str], list[AssistantStoredMessage]] = {}
        self._feedback: dict[str, list[AssistantFeedbackEntry]] = {}

    def append_message(
        self,
        _db,
        *,
        privy_user_id: str,
        session_id: str,
        role: str,
        content: str,
    ) -> AssistantStoredMessage:
        row = AssistantStoredMessage(
            role=role,
            content=content,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._messages.setdefault((privy_user_id, session_id), []).append(row)
        return row

    def get_recent_messages(
        self,
        _db,
        *,
        privy_user_id: str,
        session_id: str,
        limit: int,
    ) -> list[AssistantStoredMessage]:
        rows = self._messages.get((privy_user_id, session_id), [])
        return rows[-limit:]

    def list_recent_sessions(
        self,
        _db,
        *,
        privy_user_id: str,
        limit: int,
    ) -> list[AssistantSessionSummary]:
        rows: list[AssistantSessionSummary] = []
        for (user_id, session_id), messages in self._messages.items():
            if user_id != privy_user_id or not messages:
                continue
            title = next((m.content for m in messages if m.role == "user"), messages[-1].content)
            rows.append(
                AssistantSessionSummary(
                    session_id=session_id,
                    title=title,
                    last_message_at=messages[-1].created_at,
                )
            )

        rows.sort(key=lambda row: row.last_message_at, reverse=True)
        return rows[:limit]

    def record_feedback(
        self,
        _db,
        *,
        privy_user_id: str,
        session_id: str,
        assistant_created_at: str,
        feedback: str,
        message_content: str,
        note: str | None,
    ) -> AssistantFeedbackEntry:
        row = AssistantFeedbackEntry(
            session_id=session_id,
            assistant_created_at=assistant_created_at,
            feedback=feedback,
            message_excerpt=message_content[:120],
            note=note,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        rows = [
            existing
            for existing in self._feedback.get(privy_user_id, [])
            if not (
                existing.session_id == session_id
                and existing.assistant_created_at == assistant_created_at
            )
        ]
        rows.insert(0, row)
        self._feedback[privy_user_id] = rows
        return row

    def list_recent_feedback(
        self,
        _db,
        *,
        privy_user_id: str,
        limit: int,
    ) -> list[AssistantFeedbackEntry]:
        return list(self._feedback.get(privy_user_id, []))[:limit]


class _FakeAssistantClient:
    async def generate_reply(
        self,
        *,
        messages,
        grounding_context: str,
        feedback_context: str,
        response_style_hints: str,
    ) -> str:
        assert messages
        assert "Fresh snapshots" in grounding_context
        assert "feedback" in feedback_context.lower()
        assert "directives" in response_style_hints.lower() or "link" in response_style_hints.lower()
        return "Risk scores combine static and dynamic components."


class _FailingAssistantClient:
    async def generate_reply(
        self,
        *,
        messages,
        grounding_context: str,
        feedback_context: str,
        response_style_hints: str,
    ) -> str:
        del messages
        del grounding_context
        del feedback_context
        del response_style_hints
        raise RuntimeError("GEMINI_API_KEY is not configured")


class _FakeKnowledgeBase:
    def build_grounding_context(self, dynamic_risk_snapshot_summary: str) -> tuple[str, list[str]]:
        return (
            f"Grounded context\n{dynamic_risk_snapshot_summary}",
            ["report.md", "riskscoreplan.md"],
        )


def _make_request(path: str) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "query_string": b"",
        "scheme": "http",
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_chat_with_assistant_returns_reply_and_history(monkeypatch) -> None:
    fake_store = _FakeSessionStore()

    monkeypatch.setattr(assistant_routes, "_assistant_session_store", fake_store)
    monkeypatch.setattr(assistant_routes, "_assistant_client", _FakeAssistantClient())
    monkeypatch.setattr(assistant_routes, "_assistant_knowledge_base", _FakeKnowledgeBase())
    monkeypatch.setattr(
        assistant_routes,
        "_build_dynamic_risk_snapshot_summary",
        lambda _db: "Fresh snapshots: 6; stale snapshots: 0",
    )

    out = await assistant_routes.chat_with_assistant(
        _make_request("/api/v1/assistant/chat"),
        assistant_routes.AssistantChatRequest(message="How is risk updated?"),
        SimpleNamespace(),
        {"sub": "did:privy:123"},
    )

    assert out.session_id
    assert out.reply.startswith("Risk scores")
    assert len(out.messages) == 2
    assert out.messages[0].role == "user"
    assert out.messages[1].role == "assistant"
    assert "report.md" in out.context_sources


@pytest.mark.asyncio
async def test_chat_with_assistant_returns_503_when_gemini_unconfigured(monkeypatch) -> None:
    fake_store = _FakeSessionStore()

    monkeypatch.setattr(assistant_routes, "_assistant_session_store", fake_store)
    monkeypatch.setattr(assistant_routes, "_assistant_client", _FailingAssistantClient())
    monkeypatch.setattr(assistant_routes, "_assistant_knowledge_base", _FakeKnowledgeBase())
    monkeypatch.setattr(
        assistant_routes,
        "_build_dynamic_risk_snapshot_summary",
        lambda _db: "Fresh snapshots: 0; stale snapshots: 0",
    )

    with pytest.raises(HTTPException) as exc:
        await assistant_routes.chat_with_assistant(
            _make_request("/api/v1/assistant/chat"),
            assistant_routes.AssistantChatRequest(message="hello"),
            SimpleNamespace(),
            {"sub": "did:privy:123"},
        )

    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_get_assistant_session_rejects_blank_session_id(monkeypatch) -> None:
    fake_store = _FakeSessionStore()
    monkeypatch.setattr(assistant_routes, "_assistant_session_store", fake_store)

    with pytest.raises(HTTPException) as exc:
        await assistant_routes.get_assistant_session(
            "   ",
            _make_request("/api/v1/assistant/sessions/invalid"),
            SimpleNamespace(),
            {"sub": "did:privy:123"},
        )

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_list_assistant_sessions_returns_recent_entries(monkeypatch) -> None:
    fake_store = _FakeSessionStore()
    monkeypatch.setattr(assistant_routes, "_assistant_session_store", fake_store)

    # Session A
    fake_store.append_message(
        SimpleNamespace(),
        privy_user_id="did:privy:123",
        session_id="sessionAAA1",
        role="user",
        content="Explain daily risk snapshot",
    )
    fake_store.append_message(
        SimpleNamespace(),
        privy_user_id="did:privy:123",
        session_id="sessionAAA1",
        role="assistant",
        content="Daily snapshots are computed at 02:30 UTC.",
    )

    # Session B
    fake_store.append_message(
        SimpleNamespace(),
        privy_user_id="did:privy:123",
        session_id="sessionBBB2",
        role="user",
        content="How is static risk weighted?",
    )

    out = await assistant_routes.list_assistant_sessions(
        _make_request("/api/v1/assistant/sessions"),
        20,
        SimpleNamespace(),
        {"sub": "did:privy:123"},
    )

    assert len(out.sessions) == 2
    assert {row.session_id for row in out.sessions} == {"sessionAAA1", "sessionBBB2"}


@pytest.mark.asyncio
async def test_submit_assistant_feedback_persists_row(monkeypatch) -> None:
    fake_store = _FakeSessionStore()
    monkeypatch.setattr(assistant_routes, "_assistant_session_store", fake_store)

    payload = assistant_routes.AssistantFeedbackRequest(
        session_id="sessionAAA1",
        message_created_at="2026-04-06T01:00:00+00:00",
        message_content="Use a table for risk comparisons.",
        feedback="up",
        note="Great structure",
    )

    out = await assistant_routes.submit_assistant_feedback(
        _make_request("/api/v1/assistant/feedback"),
        payload,
        SimpleNamespace(),
        {"sub": "did:privy:123"},
    )

    assert out.session_id == "sessionAAA1"
    assert out.feedback == "up"
    assert out.note == "Great structure"


def test_feedback_request_rejects_invalid_timestamp() -> None:
    with pytest.raises(ValidationError):
        assistant_routes.AssistantFeedbackRequest(
            session_id="sessionAAA1",
            message_created_at="not-a-time",
            message_content="Response text",
            feedback="down",
        )


def test_chat_request_accepts_camel_case_aliases() -> None:
    payload = assistant_routes.AssistantChatRequest(
        sessionId="sessionAAA1",
        message="How is risk updated?",
    )
    assert payload.session_id == "sessionAAA1"


def test_feedback_request_accepts_camel_case_aliases() -> None:
    payload = assistant_routes.AssistantFeedbackRequest(
        sessionId="sessionAAA1",
        messageCreatedAt="2026-04-06T01:00:00+00:00",
        messageContent="Response text",
        feedback="up",
    )
    assert payload.session_id == "sessionAAA1"
    assert payload.message_created_at == "2026-04-06T01:00:00+00:00"
