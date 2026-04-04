from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.optimizer.health_checker import RebalanceFlag, check_protocol_health
from app.services.protocols.base import ProtocolHealth, ProtocolStatus
from app.services.protocols.euler_v2 import EulerV2Adapter


def _health_settings() -> SimpleNamespace:
    return SimpleNamespace(
        VELOCITY_THRESHOLD=0.25,
        EXPLOIT_APY_MULTIPLIER=2.0,
        UTILIZATION_THRESHOLD=0.90,
        MAX_APY_SANITY_BOUND=0.25,
        STABILITY_SWING_THRESHOLD=0.50,
        TVL_CAP_PCT=0.075,
        CIRCUIT_BREAKER_THRESHOLD=3,
    )


def _make_async_call(value):
    mock = MagicMock()
    mock.call = AsyncMock(return_value=value)
    return mock


@pytest.mark.asyncio
async def test_stability_gate_skipped_for_euler_v2():
    unstable_week = [
        Decimal("0.020"),
        Decimal("0.070"),
        Decimal("0.022"),
        Decimal("0.068"),
        Decimal("0.021"),
        Decimal("0.069"),
        Decimal("0.023"),
    ]

    protocol_health = ProtocolHealth(
        protocol_id="euler_v2",
        status=ProtocolStatus.HEALTHY,
        is_deposit_safe=True,
        is_withdrawal_safe=True,
        utilization=Decimal("0.80"),
    )

    with patch("app.services.optimizer.health_checker.get_settings", return_value=_health_settings()):
        result = await check_protocol_health(
            protocol_id="euler_v2",
            protocol_health=protocol_health,
            current_apy=Decimal("0.05"),
            twap_apy=Decimal("0.05"),
            previous_apy=None,
            yesterday_avg_apy=None,
            daily_snapshots_7d=unstable_week,
            current_position=Decimal("0"),
            protocol_tvl=Decimal("1000000"),
            circuit_breaker_failures=0,
        )

    assert result.is_deposit_safe is True
    assert all("7-day instability" not in reason for reason in result.exclusion_reasons)


@pytest.mark.asyncio
async def test_stability_gate_applies_for_benqi():
    unstable_week = [
        Decimal("0.020"),
        Decimal("0.070"),
        Decimal("0.022"),
        Decimal("0.068"),
        Decimal("0.021"),
        Decimal("0.069"),
        Decimal("0.023"),
    ]

    protocol_health = ProtocolHealth(
        protocol_id="benqi",
        status=ProtocolStatus.HEALTHY,
        is_deposit_safe=True,
        is_withdrawal_safe=True,
        utilization=Decimal("0.80"),
    )

    with patch("app.services.optimizer.health_checker.get_settings", return_value=_health_settings()):
        result = await check_protocol_health(
            protocol_id="benqi",
            protocol_health=protocol_health,
            current_apy=Decimal("0.05"),
            twap_apy=Decimal("0.05"),
            previous_apy=None,
            yesterday_avg_apy=None,
            daily_snapshots_7d=unstable_week,
            current_position=Decimal("0"),
            protocol_tvl=Decimal("1000000"),
            circuit_breaker_failures=0,
        )

    assert any("7-day instability" in reason for reason in result.exclusion_reasons)
    assert result.is_deposit_safe is False


@pytest.mark.asyncio
async def test_euler_health_uses_configured_utilization_threshold():
    settings = SimpleNamespace(
        EULER_VAULT="0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e",
        UTILIZATION_THRESHOLD=0.90,
    )

    with patch("app.services.protocols.euler_v2.get_settings", return_value=settings):
        adapter = EulerV2Adapter()

        vault = MagicMock()
        vault.functions.totalAssets.return_value = _make_async_call(1_000_000)
        vault.functions.convertToAssets.return_value = _make_async_call(1_000_000)
        # borrows=905_000 on totalAssets=1_000_000 => utilization=90.5% (>90%)
        vault.functions.totalBorrows.return_value = _make_async_call(905_000)
        adapter._get_vault = MagicMock(return_value=vault)

        health = await adapter.get_health()

    assert health.status == ProtocolStatus.HIGH_UTILIZATION
    assert health.is_deposit_safe is False
    assert health.utilization is not None
    assert health.utilization > Decimal("0.90")


@pytest.mark.asyncio
async def test_tvl_cap_uses_available_liquidity() -> None:
    """TVL cap should use available liquidity (TVL * (1 - utilization))."""
    protocol_health = ProtocolHealth(
        protocol_id="benqi",
        status=ProtocolStatus.HEALTHY,
        is_deposit_safe=True,
        is_withdrawal_safe=True,
        utilization=Decimal("0.90"),
    )

    with patch("app.services.optimizer.health_checker.get_settings", return_value=_health_settings()):
        result = await check_protocol_health(
            protocol_id="benqi",
            protocol_health=protocol_health,
            current_apy=Decimal("0.04"),
            twap_apy=Decimal("0.04"),
            previous_apy=None,
            yesterday_avg_apy=None,
            daily_snapshots_7d=None,
            current_position=Decimal("1000000"),
            protocol_tvl=Decimal("10000000"),
            circuit_breaker_failures=0,
        )

    # available_liquidity = 10m * (1 - 0.9) = 1m; position share = 100%
    assert any("Liquidity cap exceeded" in reason for reason in result.exclusion_reasons)
    assert result.flag == RebalanceFlag.FORCED_REBALANCE


@pytest.mark.asyncio
async def test_tvl_cap_falls_back_to_total_tvl_when_utilization_missing() -> None:
    """utilization=None should preserve old total-TVL semantics."""
    protocol_health = ProtocolHealth(
        protocol_id="benqi",
        status=ProtocolStatus.HEALTHY,
        is_deposit_safe=True,
        is_withdrawal_safe=True,
        utilization=None,
    )

    with patch("app.services.optimizer.health_checker.get_settings", return_value=_health_settings()):
        result = await check_protocol_health(
            protocol_id="benqi",
            protocol_health=protocol_health,
            current_apy=Decimal("0.04"),
            twap_apy=Decimal("0.04"),
            previous_apy=None,
            yesterday_avg_apy=None,
            daily_snapshots_7d=None,
            current_position=Decimal("500000"),
            protocol_tvl=Decimal("10000000"),
            circuit_breaker_failures=0,
        )

    # 500k / 10m = 5% < 7.5%, so cap should not trigger.
    assert all("Liquidity cap exceeded" not in reason for reason in result.exclusion_reasons)
