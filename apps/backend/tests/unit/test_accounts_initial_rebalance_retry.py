"""Unit tests for initial rebalance retry semantics after session-key storage."""

from unittest.mock import AsyncMock, patch

import pytest

from app.api.routes import accounts


@pytest.mark.asyncio
async def test_initial_rebalance_retries_transient_inflight_skip() -> None:
    """A transient in-flight skip should be retried within the same bootstrap task."""
    accounts._rebalance_locks.clear()

    rebalancer = AsyncMock()
    rebalancer.check_and_rebalance = AsyncMock(side_effect=[
        {"status": "skipped", "skip_reason": "Another rebalance attempt in flight"},
        {"status": "executed", "tx_hash": "0xabc"},
    ])

    with patch("app.services.optimizer.rebalancer.Rebalancer", return_value=rebalancer), \
         patch("asyncio.sleep", new_callable=AsyncMock) as sleep_mock:
        await accounts._trigger_initial_rebalance("acct-1", "0x123")

    assert rebalancer.check_and_rebalance.await_count == 2
    assert sleep_mock.await_count == 2


@pytest.mark.asyncio
async def test_initial_rebalance_does_not_retry_non_transient_skip() -> None:
    """Terminal skips (e.g. no-op decisions) should return without extra retries."""
    accounts._rebalance_locks.clear()

    rebalancer = AsyncMock()
    rebalancer.check_and_rebalance = AsyncMock(return_value={
        "status": "skipped",
        "skip_reason": "APY improvement below beat margin",
    })

    with patch("app.services.optimizer.rebalancer.Rebalancer", return_value=rebalancer), \
         patch("asyncio.sleep", new_callable=AsyncMock) as sleep_mock:
        await accounts._trigger_initial_rebalance("acct-2", "0x456")

    assert rebalancer.check_and_rebalance.await_count == 1
    assert sleep_mock.await_count == 1
