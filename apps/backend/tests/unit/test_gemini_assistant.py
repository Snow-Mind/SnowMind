from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.assistant import gemini_assistant
from app.services.assistant.gemini_assistant import GeminiAssistantClient
from app.services.assistant.session_store import AssistantStoredMessage


class _FakeResponse:
    def __init__(self, body: dict):
        self._body = body

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._body


class _FakeAsyncClient:
    def __init__(self, *, timeout: int):
        self.timeout = timeout

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        del exc_type
        del exc
        del tb
        return False

    async def post(self, url: str, headers: dict, json: dict):
        _CAPTURE["url"] = url
        _CAPTURE["headers"] = headers
        _CAPTURE["json"] = json
        return _FakeResponse(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": "Dynamic risk updates are calculated daily from on-chain data."}
                            ]
                        }
                    }
                ]
            }
        )


_CAPTURE: dict[str, object] = {}


@pytest.mark.asyncio
async def test_gemini_client_uses_x_goog_api_key_header(monkeypatch) -> None:
    settings = SimpleNamespace(
        GEMINI_API_KEY="test-key",
        GEMINI_MODEL="gemini-flash-latest",
        GEMINI_TIMEOUT_SECONDS=19,
    )

    monkeypatch.setattr(gemini_assistant, "get_settings", lambda: settings)
    monkeypatch.setattr(gemini_assistant.httpx, "AsyncClient", _FakeAsyncClient)

    out = await GeminiAssistantClient().generate_reply(
        messages=[
            AssistantStoredMessage(
                role="user",
                content="How is risk updated?",
                created_at="2026-04-06T00:00:00+00:00",
            )
        ],
        grounding_context="risk context",
        feedback_context="thumbs_up=1",
    )

    assert out.startswith("Dynamic risk updates")
    assert _CAPTURE["url"] == (
        "https://generativelanguage.googleapis.com/v1beta/"
        "models/gemini-flash-latest:generateContent"
    )
    headers = _CAPTURE["headers"]
    assert isinstance(headers, dict)
    assert headers.get("X-goog-api-key") == "test-key"
    assert headers.get("Content-Type") == "application/json"
    payload = _CAPTURE["json"]
    assert isinstance(payload, dict)
    system_instruction = payload.get("systemInstruction")
    assert isinstance(system_instruction, dict)
    parts = system_instruction.get("parts")
    assert isinstance(parts, list) and parts
    first_part = parts[0]
    assert isinstance(first_part, dict)
    instruction_text = first_part.get("text")
    assert isinstance(instruction_text, str)
    assert "Markdown table" in instruction_text
    assert "bullet lists" in instruction_text


@pytest.mark.asyncio
async def test_gemini_client_rejects_missing_api_key(monkeypatch) -> None:
    settings = SimpleNamespace(
        GEMINI_API_KEY="",
        GEMINI_MODEL="gemini-flash-latest",
        GEMINI_TIMEOUT_SECONDS=20,
    )
    monkeypatch.setattr(gemini_assistant, "get_settings", lambda: settings)

    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        await GeminiAssistantClient().generate_reply(
            messages=[],
            grounding_context="context",
            feedback_context="none",
        )
