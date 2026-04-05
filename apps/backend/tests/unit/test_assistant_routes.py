from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.routes import assistant as assistant_routes
from app.services.assistant.session_store import AssistantStoredMessage


class _FakeSessionStore:
    def __init__(self) -> None:
        self._messages: dict[tuple[str, str], list[AssistantStoredMessage]] = {}

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


class _FakeAssistantClient:
    async def generate_reply(self, *, messages, grounding_context: str) -> str:
        assert messages
        assert "Fresh snapshots" in grounding_context
        return "Risk scores combine static and dynamic components."


class _FailingAssistantClient:
    async def generate_reply(self, *, messages, grounding_context: str) -> str:
        del messages
        del grounding_context
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
