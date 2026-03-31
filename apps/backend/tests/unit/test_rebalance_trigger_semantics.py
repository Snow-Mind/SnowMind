"""Unit tests for rebalance trigger API semantics.

Ensures manual trigger returns stable 200-level payloads for expected
session-key lifecycle states instead of surfacing transient 500 errors.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.requests import Request

from app.api.routes import rebalance


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/rebalance/0x/rebalance",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
        }
    )


@pytest.mark.asyncio
async def test_trigger_returns_skipped_for_inactive_account() -> None:
    """Inactive accounts should return a skipped response, not 4xx."""
    with patch("app.api.routes.rebalance._lookup_account", new_callable=AsyncMock) as lookup_mock:
        lookup_mock.return_value = {
            "id": "acct-1",
            "address": "0x1111111111111111111111111111111111111111",
            "is_active": False,
        }

        response = await rebalance.trigger_rebalance(
            request=_request(),
            address="0x1111111111111111111111111111111111111111",
            db=MagicMock(),
            _auth={"sub": "did:privy:test"},
        )

    assert response.status == "skipped"
    assert response.detail == {"skip_reason": "Account is inactive"}


@pytest.mark.asyncio
async def test_trigger_returns_skipped_for_missing_session_key_valueerror() -> None:
    """No-active-session-key ValueError should map to skipped status."""
    with patch("app.api.routes.rebalance._lookup_account", new_callable=AsyncMock) as lookup_mock, \
         patch("app.services.optimizer.rebalancer.Rebalancer") as rebalancer_cls:
        lookup_mock.return_value = {
            "id": "acct-2",
            "address": "0x2222222222222222222222222222222222222222",
            "is_active": True,
        }
        rebalancer_instance = rebalancer_cls.return_value
        rebalancer_instance.check_and_rebalance = AsyncMock(
            side_effect=ValueError("No active session key for account acct-2")
        )

        response = await rebalance.trigger_rebalance(
            request=_request(),
            address="0x2222222222222222222222222222222222222222",
            db=MagicMock(),
            _auth={"sub": "did:privy:test"},
        )

    assert response.status == "skipped"
    assert isinstance(response.detail, dict)
    assert "No active session key" in str(response.detail.get("skip_reason", ""))


@pytest.mark.asyncio
async def test_trigger_passes_through_rebalancer_status_on_success() -> None:
    """Successful trigger should return the rebalancer result status/details."""
    with patch("app.api.routes.rebalance._lookup_account", new_callable=AsyncMock) as lookup_mock, \
         patch("app.services.optimizer.rebalancer.Rebalancer") as rebalancer_cls:
        lookup_mock.return_value = {
            "id": "acct-3",
            "address": "0x3333333333333333333333333333333333333333",
            "is_active": True,
        }
        rebalancer_instance = rebalancer_cls.return_value
        rebalancer_instance.check_and_rebalance = AsyncMock(
            return_value={"status": "executed", "tx_hash": "0xabc"}
        )

        response = await rebalance.trigger_rebalance(
            request=_request(),
            address="0x3333333333333333333333333333333333333333",
            db=MagicMock(),
            _auth={"sub": "did:privy:test"},
        )

    assert response.status == "executed"
    assert response.detail == {"status": "executed", "tx_hash": "0xabc"}
