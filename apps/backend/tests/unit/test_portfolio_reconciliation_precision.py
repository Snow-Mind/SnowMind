"""Unit tests for portfolio balance reconciliation precision and read failure behavior."""

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.routes import portfolio


def test_should_refresh_amount_tracks_small_yield_deltas() -> None:
    """Small positive growth should be reflected instead of hidden behind coarse thresholds."""
    assert portfolio._should_refresh_amount(Decimal("50.000000"), Decimal("50.000200"))
    assert not portfolio._should_refresh_amount(Decimal("50.000000"), Decimal("50.0000004"))


@pytest.mark.asyncio
async def test_get_protocol_balance_returns_none_after_rate_limit_retries() -> None:
    """Protocol balance reads should fail-safe (None) after retrying 429 errors."""
    adapter = MagicMock()
    adapter.get_user_balance = AsyncMock(side_effect=RuntimeError("429 Too Many Requests"))

    settings = MagicMock()
    settings.USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    rpc_manager = MagicMock()

    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio.get_adapter", return_value=adapter
    ), patch("app.core.rpc.get_rpc_manager", return_value=rpc_manager):
        result = await portfolio._get_protocol_balance("0xabc", "benqi")

    assert result is None
    assert adapter.get_user_balance.await_count == 2
    rpc_manager.report_rate_limit.assert_called_once()


@pytest.mark.asyncio
async def test_get_protocol_balance_returns_none_on_non_retryable_error() -> None:
    """Non-rate-limit balance read failures should return None immediately."""
    adapter = MagicMock()
    adapter.get_user_balance = AsyncMock(side_effect=RuntimeError("execution reverted"))

    settings = MagicMock()
    settings.USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio.get_adapter", return_value=adapter
    ):
        result = await portfolio._get_protocol_balance("0xabc", "benqi")

    assert result is None
    assert adapter.get_user_balance.await_count == 1
