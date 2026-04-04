from decimal import Decimal

from app.services.optimizer.rebalancer import _build_user_preferences


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
