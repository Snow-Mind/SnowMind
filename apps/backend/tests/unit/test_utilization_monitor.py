from collections import deque
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.workers.utilization_monitor import PositionSnapshot, UtilizationMonitor


@pytest.fixture
def monitor() -> UtilizationMonitor:
    settings = SimpleNamespace(
        UTILIZATION_POLL_INTERVAL=30,
        EMERGENCY_UTILIZATION_THRESHOLD=0.92,
        UTILIZATION_VELOCITY_THRESHOLD=0.10,
        UTILIZATION_CONFIRM_COUNT=2,
        EMERGENCY_WITHDRAWAL_COOLDOWN=300,
    )

    with patch("app.workers.utilization_monitor.get_settings", return_value=settings), patch(
        "app.workers.utilization_monitor.get_supabase", return_value=MagicMock()
    ), patch("app.workers.utilization_monitor.Rebalancer") as rebalancer_cls:
        rebalancer_cls.return_value = MagicMock()
        return UtilizationMonitor()


def test_evaluate_thresholds_absolute_trigger(monitor: UtilizationMonitor) -> None:
    monitor._history["aave_v3"] = deque(
        [None, Decimal("0.93"), Decimal("0.94")],
        maxlen=20,
    )

    reason = monitor._evaluate_thresholds("aave_v3")

    assert reason is not None
    assert "absolute utilization" in reason


def test_evaluate_thresholds_velocity_trigger(monitor: UtilizationMonitor) -> None:
    monitor._history["benqi"] = deque(
        [Decimal("0.70"), Decimal("0.82")],
        maxlen=20,
    )

    reason = monitor._evaluate_thresholds("benqi")

    assert reason is not None
    assert "jumped" in reason


def test_evaluate_thresholds_requires_consecutive_successful_reads(
    monitor: UtilizationMonitor,
) -> None:
    monitor._history["euler_v2"] = deque(
        [Decimal("0.95"), None, Decimal("0.96")],
        maxlen=20,
    )

    assert monitor._evaluate_thresholds("euler_v2") is None


@pytest.mark.asyncio
async def test_execute_targeted_withdrawal_sets_cooldown(
    monitor: UtilizationMonitor,
) -> None:
    monitor._resolve_withdrawable_amount = AsyncMock(return_value=Decimal("50.000000"))
    monitor._record_withdrawal_activity = MagicMock()
    monitor.rebalancer.execute_partial_withdrawal = AsyncMock(return_value="0xtx")

    position = PositionSnapshot(
        account_id="acct-1",
        smart_account_address="0x4006ce775C928E4e4dE5BAC01d9d69Ed3a793556",
        amount_usdc=Decimal("50"),
    )

    await monitor._execute_targeted_withdrawal(
        protocol_id="aave_v3",
        position=position,
        trigger_reason="absolute utilization above 92%",
    )
    await monitor._execute_targeted_withdrawal(
        protocol_id="aave_v3",
        position=position,
        trigger_reason="absolute utilization above 92%",
    )

    # Second call should be skipped due to cooldown.
    assert monitor.rebalancer.execute_partial_withdrawal.await_count == 1


@pytest.mark.asyncio
async def test_fetch_utilizations_retries_then_succeeds(monitor: UtilizationMonitor) -> None:
    adapter = MagicMock()
    adapter.get_utilization = AsyncMock(side_effect=[RuntimeError("rpc"), Decimal("0.95")])

    with patch("app.workers.utilization_monitor.ALL_ADAPTERS", {"benqi": adapter}), patch(
        "app.workers.utilization_monitor.asyncio.sleep", AsyncMock(return_value=None)
    ):
        results = await monitor._fetch_utilizations(["benqi"])

    assert results["benqi"] == Decimal("0.95")
    assert adapter.get_utilization.await_count == 2


@pytest.mark.asyncio
async def test_fetch_utilizations_returns_none_after_retry_exhaustion(monitor: UtilizationMonitor) -> None:
    adapter = MagicMock()
    adapter.get_utilization = AsyncMock(side_effect=RuntimeError("rpc-down"))

    with patch("app.workers.utilization_monitor.ALL_ADAPTERS", {"benqi": adapter}), patch(
        "app.workers.utilization_monitor.asyncio.sleep", AsyncMock(return_value=None)
    ):
        results = await monitor._fetch_utilizations(["benqi"])

    assert results["benqi"] is None
    assert adapter.get_utilization.await_count == 3
