"""Unit tests for backend -> execution service authenticated requests."""

from __future__ import annotations

import hashlib
import hmac
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.execution.executor import ExecutionService


@pytest.mark.asyncio
async def test_post_adds_signed_headers_when_internal_key_present() -> None:
    service = ExecutionService()
    payload = {"foo": "bar", "amount": "1000"}

    settings = MagicMock(
        EXECUTION_SERVICE_URL="http://execution.local",
        INTERNAL_SERVICE_KEY="super-secret-key",
    )

    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json.return_value = {"ok": True}

    client_ctx = AsyncMock()
    client_ctx.post.return_value = response
    client_ctx.__aenter__.return_value = client_ctx
    client_ctx.__aexit__.return_value = False

    with (
        patch("app.services.execution.executor.get_settings", return_value=settings),
        patch("app.services.execution.executor.httpx.AsyncClient", return_value=client_ctx),
        patch("app.services.execution.executor.time.time", return_value=1700000000),
        patch("app.services.execution.executor.secrets.token_hex", return_value="abc123nonce"),
    ):
        result = await service._post("/execute-rebalance", payload)

    assert result == {"ok": True}
    args = client_ctx.post.call_args.args
    kwargs = client_ctx.post.call_args.kwargs
    assert args[0] == "http://execution.local/execute-rebalance"

    headers = kwargs["headers"]
    assert headers["x-internal-key"] == "super-secret-key"
    assert headers["x-request-timestamp"] == "1700000000"
    assert headers["x-request-nonce"] == "abc123nonce"

    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    expected_message = "POST\n/execute-rebalance\n1700000000\nabc123nonce\n" + body
    expected_sig = hmac.new(
        b"super-secret-key",
        expected_message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert headers["x-request-signature"] == expected_sig
    assert kwargs["content"] == body


@pytest.mark.asyncio
async def test_post_omits_signature_headers_without_internal_key() -> None:
    service = ExecutionService()
    payload = {"foo": "bar"}

    settings = MagicMock(
        EXECUTION_SERVICE_URL="http://execution.local",
        INTERNAL_SERVICE_KEY="",
    )

    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json.return_value = {"ok": True}

    client_ctx = AsyncMock()
    client_ctx.post.return_value = response
    client_ctx.__aenter__.return_value = client_ctx
    client_ctx.__aexit__.return_value = False

    with (
        patch("app.services.execution.executor.get_settings", return_value=settings),
        patch("app.services.execution.executor.httpx.AsyncClient", return_value=client_ctx),
    ):
        result = await service._post("/execute/withdrawal", payload)

    assert result == {"ok": True}
    kwargs = client_ctx.post.call_args.kwargs
    headers = kwargs["headers"]
    assert headers["x-internal-key"] == ""
    assert "x-request-timestamp" not in headers
    assert "x-request-nonce" not in headers
    assert "x-request-signature" not in headers
