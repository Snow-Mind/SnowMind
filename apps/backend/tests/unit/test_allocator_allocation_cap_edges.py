from decimal import Decimal

from app.services.optimizer.allocator import UserPreference, compute_allocation
from app.services.optimizer.health_checker import HealthCheckResult


def _healthy(protocol_id: str) -> HealthCheckResult:
    return HealthCheckResult(
        protocol_id=protocol_id,
        is_healthy=True,
        is_deposit_safe=True,
        is_withdrawal_safe=True,
    )


def test_allocation_caps_below_100_can_leave_idle_balance() -> None:
    total = Decimal("1000")
    result = compute_allocation(
        health_results={
            "spark": _healthy("spark"),
            "aave_v3": _healthy("aave_v3"),
        },
        twap_apys={
            "spark": Decimal("0.05"),
            "aave_v3": Decimal("0.04"),
        },
        protocol_tvls={
            "spark": Decimal("100000000"),
            "aave_v3": Decimal("100000000"),
        },
        total_balance=total,
        user_preferences={
            "spark": UserPreference(protocol_id="spark", enabled=True, max_pct=Decimal("0.20")),
            "aave_v3": UserPreference(protocol_id="aave_v3", enabled=True, max_pct=Decimal("0.30")),
        },
    )

    assert sum(result.allocations.values(), Decimal("0")) == Decimal("500")
    assert result.idle_amount == Decimal("500")


def test_allocation_caps_above_100_do_not_overallocate_total_balance() -> None:
    total = Decimal("1000")
    result = compute_allocation(
        health_results={
            "spark": _healthy("spark"),
            "aave_v3": _healthy("aave_v3"),
        },
        twap_apys={
            "spark": Decimal("0.05"),
            "aave_v3": Decimal("0.04"),
        },
        protocol_tvls={
            "spark": Decimal("100000000"),
            "aave_v3": Decimal("100000000"),
        },
        total_balance=total,
        user_preferences={
            "spark": UserPreference(protocol_id="spark", enabled=True, max_pct=Decimal("0.80")),
            "aave_v3": UserPreference(protocol_id="aave_v3", enabled=True, max_pct=Decimal("0.80")),
        },
    )

    assert sum(result.allocations.values(), Decimal("0")) == total
    assert result.idle_amount == Decimal("0")
    assert result.allocations["spark"] <= total * Decimal("0.80")
    assert result.allocations["aave_v3"] <= total * Decimal("0.80")


def test_all_zero_caps_keep_all_funds_idle() -> None:
    total = Decimal("1000")
    result = compute_allocation(
        health_results={
            "spark": _healthy("spark"),
            "aave_v3": _healthy("aave_v3"),
        },
        twap_apys={
            "spark": Decimal("0.05"),
            "aave_v3": Decimal("0.04"),
        },
        protocol_tvls={
            "spark": Decimal("100000000"),
            "aave_v3": Decimal("100000000"),
        },
        total_balance=total,
        user_preferences={
            "spark": UserPreference(protocol_id="spark", enabled=True, max_pct=Decimal("0")),
            "aave_v3": UserPreference(protocol_id="aave_v3", enabled=True, max_pct=Decimal("0")),
        },
    )

    assert result.allocations == {}
    assert result.idle_amount == total


def test_missing_cap_entry_is_treated_as_unbounded_for_that_market() -> None:
    total = Decimal("1000")
    result = compute_allocation(
        health_results={
            "spark": _healthy("spark"),
            "aave_v3": _healthy("aave_v3"),
        },
        twap_apys={
            "spark": Decimal("0.05"),
            "aave_v3": Decimal("0.04"),
        },
        protocol_tvls={
            "spark": Decimal("100000000"),
            "aave_v3": Decimal("100000000"),
        },
        total_balance=total,
        user_preferences={
            "spark": UserPreference(protocol_id="spark", enabled=True, max_pct=Decimal("0.20")),
        },
    )

    assert result.allocations["spark"] == Decimal("200")
    assert result.allocations["aave_v3"] == Decimal("800")
    assert result.idle_amount == Decimal("0")
