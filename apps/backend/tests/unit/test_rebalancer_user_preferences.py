from decimal import Decimal

from app.services.optimizer.rebalancer import _build_user_preferences, _detect_user_cap_breaches


def test_build_user_preferences_without_caps_keeps_unbounded_preferences() -> None:
    prefs = _build_user_preferences({"aave_v3", "spark"}, allocation_caps=None)

    assert prefs["aave_v3"].enabled is True
    assert prefs["spark"].enabled is True
    assert prefs["aave_v3"].max_pct is None
    assert prefs["spark"].max_pct is None


def test_build_user_preferences_applies_caps_and_alias_mapping() -> None:
    prefs = _build_user_preferences(
        {"aave_v3", "spark", "euler_v2"},
        allocation_caps={"aave": 50, "spark": 35, "euler_v2": 10},
    )

    assert prefs["aave_v3"].max_pct == Decimal("0.5")
    assert prefs["spark"].max_pct == Decimal("0.35")
    assert prefs["euler_v2"].max_pct == Decimal("0.1")


def test_build_user_preferences_clamps_invalid_cap_values() -> None:
    prefs = _build_user_preferences(
        {"aave_v3", "spark"},
        allocation_caps={"aave_v3": 150, "spark": -5},
    )

    assert prefs["aave_v3"].max_pct == Decimal("1")
    assert prefs["spark"].max_pct == Decimal("0")


def test_build_user_preferences_ignores_malformed_cap_values() -> None:
    prefs = _build_user_preferences(
        {"aave_v3", "spark"},
        allocation_caps={
            "aave_v3": "not-a-number",  # type: ignore[dict-item]
            "spark": True,               # type: ignore[dict-item]
        },
    )

    # Malformed caps should be ignored (treated as unbounded), not crash rebalance.
    assert prefs["aave_v3"].max_pct is None
    assert prefs["spark"].max_pct is None


def test_detect_user_cap_breaches_flags_protocol_over_cap() -> None:
    breaches = _detect_user_cap_breaches(
        current_allocations={"silo_savusd_usdc": Decimal("80"), "benqi": Decimal("20")},
        total_usd=Decimal("100"),
        allocation_caps={"silo_savusd_usdc": 70, "benqi": 100},
    )

    assert breaches == ["silo_savusd_usdc"]


def test_detect_user_cap_breaches_uses_aave_alias_cap() -> None:
    breaches = _detect_user_cap_breaches(
        current_allocations={"aave_v3": Decimal("60")},
        total_usd=Decimal("100"),
        allocation_caps={"aave": 50},
    )

    assert breaches == ["aave_v3"]


def test_detect_user_cap_breaches_ignores_idle_and_small_jitter() -> None:
    breaches = _detect_user_cap_breaches(
        current_allocations={"idle": Decimal("10"), "benqi": Decimal("50.05")},
        total_usd=Decimal("100"),
        allocation_caps={"benqi": 50},
    )

    assert breaches == []
