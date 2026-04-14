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
async def test_post_raises_without_internal_service_key() -> None:
    service = ExecutionService()
    payload = {"foo": "bar"}

    settings = MagicMock(
        EXECUTION_SERVICE_URL="http://execution.local",
        INTERNAL_SERVICE_KEY="",
    )

    with (
        patch("app.services.execution.executor.get_settings", return_value=settings),
    ):
        with pytest.raises(RuntimeError, match="INTERNAL_SERVICE_KEY is required"):
            await service._post("/execute/withdrawal", payload)


@pytest.mark.asyncio
async def test_execute_withdrawal_requires_userop_confirmation() -> None:
    service = ExecutionService()
    payload = {"smartAccountAddress": "0x1111111111111111111111111111111111111111"}

    with (
        patch.object(
            service,
            "_post",
            new=AsyncMock(return_value={"txHash": "0xabc"}),
        ) as mock_post,
        patch(
            "app.services.execution.executor.assert_userop_execution_succeeded",
            new=AsyncMock(),
        ) as mock_assert,
    ):
        result = await service.execute_withdrawal(payload)

    mock_post.assert_awaited_once_with("/execute/withdrawal", payload)
    mock_assert.assert_awaited_once_with(
        "0xabc",
        "0x1111111111111111111111111111111111111111",
    )
    assert result["userOpConfirmed"] is True


@pytest.mark.asyncio
async def test_execute_withdrawal_rejects_missing_tx_hash() -> None:
    service = ExecutionService()
    payload = {"smartAccountAddress": "0x1111111111111111111111111111111111111111"}

    with (
        patch.object(
            service,
            "_post",
            new=AsyncMock(return_value={}),
        ) as mock_post,
        patch(
            "app.services.execution.executor.assert_userop_execution_succeeded",
            new=AsyncMock(),
        ) as mock_assert,
    ):
        with pytest.raises(RuntimeError, match="missing txHash"):
            await service.execute_withdrawal(payload)

    mock_post.assert_awaited_once_with("/execute/withdrawal", payload)
    mock_assert.assert_not_awaited()


@pytest.mark.asyncio
async def test_execute_rebalance_requires_userop_confirmation() -> None:
    service = ExecutionService()

    settings = MagicMock(
        AAVE_V3_POOL="0x0000000000000000000000000000000000000001",
        BENQI_QIUSDC="0x0000000000000000000000000000000000000002",
        SPARK_SPUSDC="0x0000000000000000000000000000000000000003",
        EULER_VAULT="0x0000000000000000000000000000000000000004",
        SILO_SAVUSD_VAULT="0x0000000000000000000000000000000000000005",
        SILO_SUSDP_VAULT="0x0000000000000000000000000000000000000006",
        USDC_ADDRESS="0x0000000000000000000000000000000000000007",
        PERMIT2="0x0000000000000000000000000000000000000008",
        REGISTRY_CONTRACT_ADDRESS="0x0000000000000000000000000000000000000009",
    )

    with (
        patch("app.services.execution.executor.get_settings", return_value=settings),
        patch.object(
            service,
            "_post",
            new=AsyncMock(return_value={"txHash": "0xdef"}),
        ) as mock_post,
        patch(
            "app.services.execution.executor.assert_userop_execution_succeeded",
            new=AsyncMock(),
        ) as mock_assert,
    ):
        result = await service.execute_rebalance(
            serialized_permission="perm",
            smart_account_address="0x2222222222222222222222222222222222222222",
            withdrawals=[],
            deposits=[],
        )

    assert result["userOpConfirmed"] is True
    mock_post.assert_awaited_once()
    mock_assert.assert_awaited_once_with(
        "0xdef",
        "0x2222222222222222222222222222222222222222",
    )
