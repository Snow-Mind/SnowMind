"""Unit tests for skipped-market reason suffix formatting."""

from app.services.optimizer.health_checker import HealthCheckResult
from app.services.optimizer.rebalancer import _format_skipped_markets_suffix


def test_skipped_market_suffix_includes_protocol_and_reason() -> None:
    health_results = {
        "euler_v2": HealthCheckResult(
            protocol_id="euler_v2",
            is_healthy=True,
            is_deposit_safe=False,
            is_withdrawal_safe=True,
            exclusion_reasons=["Liquidity stress: utilization 93.2% > 90.0%"],
        ),
        "spark": HealthCheckResult(
            protocol_id="spark",
            is_healthy=True,
            is_deposit_safe=True,
            is_withdrawal_safe=True,
        ),
    }

    suffix = _format_skipped_markets_suffix(health_results)

    assert suffix.startswith(" Skipped markets: ")
    assert "Euler (Liquidity stress: utilization 93.2% > 90.0%)" in suffix
    assert "Spark" not in suffix


def test_skipped_market_suffix_is_empty_when_all_markets_are_deposit_safe() -> None:
    health_results = {
        "aave_v3": HealthCheckResult(
            protocol_id="aave_v3",
            is_healthy=True,
            is_deposit_safe=True,
            is_withdrawal_safe=True,
        ),
    }

    assert _format_skipped_markets_suffix(health_results) == ""


def test_skipped_market_suffix_caps_visible_entries() -> None:
    health_results = {
        "aave_v3": HealthCheckResult(
            protocol_id="aave_v3",
            is_healthy=True,
            is_deposit_safe=False,
            is_withdrawal_safe=True,
            exclusion_reasons=["Velocity check failed"],
        ),
        "benqi": HealthCheckResult(
            protocol_id="benqi",
            is_healthy=True,
            is_deposit_safe=False,
            is_withdrawal_safe=True,
            exclusion_reasons=["Liquidity stress"],
        ),
        "euler_v2": HealthCheckResult(
            protocol_id="euler_v2",
            is_healthy=True,
            is_deposit_safe=False,
            is_withdrawal_safe=True,
            exclusion_reasons=["Utilization > 90%"],
        ),
        "silo_savusd_usdc": HealthCheckResult(
            protocol_id="silo_savusd_usdc",
            is_healthy=True,
            is_deposit_safe=False,
            is_withdrawal_safe=True,
            exclusion_reasons=["Circuit breaker"],
        ),
    }

    suffix = _format_skipped_markets_suffix(health_results)

    assert "+1 more" in suffix
