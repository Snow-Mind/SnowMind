from collections import deque
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

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


def test_evaluate_thresholds_enforces_92_percent_floor(monitor: UtilizationMonitor) -> None:
    # Even if env is set below 92%, emergency trigger floor remains conservative.
    monitor.settings.EMERGENCY_UTILIZATION_THRESHOLD = 0.90
    monitor._history["aave_v3"] = deque(
        [Decimal("0.92"), Decimal("0.92")],
        maxlen=20,
    )

    reason = monitor._evaluate_thresholds("aave_v3")

    assert reason is not None
    assert "92.0%" in reason


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
    monitor.rebalancer.check_and_rebalance = AsyncMock(return_value={"status": "executed"})

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
    assert monitor.rebalancer.check_and_rebalance.await_count == 1


@pytest.mark.asyncio
async def test_execute_targeted_withdrawal_post_rebalance_failure_nonfatal(
    monitor: UtilizationMonitor,
) -> None:
    monitor._resolve_withdrawable_amount = AsyncMock(return_value=Decimal("25.000000"))
    monitor._record_withdrawal_activity = MagicMock()
    monitor.rebalancer.execute_partial_withdrawal = AsyncMock(return_value="0xtx")
    monitor.rebalancer.check_and_rebalance = AsyncMock(side_effect=RuntimeError("planner failure"))

    position = PositionSnapshot(
        account_id="acct-2",
        smart_account_address="0x4006ce775C928E4e4dE5BAC01d9d69Ed3a793556",
        amount_usdc=Decimal("25"),
    )

    # Post-withdraw rebalance failures must never undo or block emergency exits.
    await monitor._execute_targeted_withdrawal(
        protocol_id="silo_savusd_usdc",
        position=position,
        trigger_reason="absolute utilization above 92%",
    )

    assert monitor.rebalancer.execute_partial_withdrawal.await_count == 1
    assert monitor.rebalancer.check_and_rebalance.await_count == 1


def test_load_active_positions_filters_non_executable_session_keys(
    monitor: UtilizationMonitor,
) -> None:
    executable_account = str(uuid4())
    missing_key_account = str(uuid4())

    query = MagicMock()
    monitor.db.table.return_value = query
    query.select.return_value = query
    query.eq.return_value = query
    query.gt.return_value = query
    query.execute.side_effect = [
        MagicMock(
            data=[
                {"id": executable_account, "address": "0x1111111111111111111111111111111111111111"},
                {"id": missing_key_account, "address": "0x2222222222222222222222222222222222222222"},
            ]
        ),
        MagicMock(
            data=[
                {"account_id": executable_account, "expires_at": "2099-01-01T00:00:00Z"},
                {"account_id": missing_key_account, "expires_at": "2099-01-01T00:00:00Z"},
            ]
        ),
        MagicMock(
            data=[
                {
                    "account_id": executable_account,
                    "protocol_id": "silo_savusd_usdc",
                    "amount_usdc": "10.0",
                },
                {
                    "account_id": missing_key_account,
                    "protocol_id": "silo_savusd_usdc",
                    "amount_usdc": "10.0",
                },
            ]
        ),
    ]

    def _mock_key_lookup(_db, account_uuid):
        if str(account_uuid) == executable_account:
            return {
                "session_private_key": "0xabc",
                "serialized_permission": "perm",
            }
        raise ValueError("Active session key is missing session private key. User must re-grant.")

    with patch(
        "app.workers.utilization_monitor.get_active_session_key_record",
        side_effect=_mock_key_lookup,
    ):
        positions = monitor._load_active_positions()

    assert set(positions.keys()) == {"silo_savusd_usdc"}
    assert len(positions["silo_savusd_usdc"]) == 1
    assert positions["silo_savusd_usdc"][0].account_id == executable_account


@pytest.mark.asyncio
async def test_execute_targeted_withdrawal_non_retryable_failure_sets_cooldown(
    monitor: UtilizationMonitor,
) -> None:
    monitor._resolve_withdrawable_amount = AsyncMock(return_value=Decimal("50.000000"))
    monitor._record_withdrawal_activity = MagicMock()
    monitor.rebalancer.execute_partial_withdrawal = AsyncMock(
        side_effect=ValueError(
            "Active session key is missing session private key. User must re-grant session key."
        )
    )

    position = PositionSnapshot(
        account_id="acct-3",
        smart_account_address="0x4006ce775C928E4e4dE5BAC01d9d69Ed3a793556",
        amount_usdc=Decimal("50"),
    )

    await monitor._execute_targeted_withdrawal(
        protocol_id="silo_savusd_usdc",
        position=position,
        trigger_reason="absolute utilization above 92%",
    )

    assert ("acct-3", "silo_savusd_usdc") in monitor._cooldowns

    await monitor._execute_targeted_withdrawal(
        protocol_id="silo_savusd_usdc",
        position=position,
        trigger_reason="absolute utilization above 92%",
    )

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
