import pytest

from app.api.routes.accounts import (
    _effective_cap_total_pct,
    _has_deployable_cap,
    _normalize_allocation_caps,
    _scope_allocation_caps,
)


def test_normalize_allocation_caps_canonicalizes_alias_and_filters_unknown() -> None:
    normalized = _normalize_allocation_caps(
        {
            "aave": 50,
            "spark": "35",
            "unknown": 20,
        },
        strict=False,
    )

    assert normalized == {
        "aave_v3": 50,
        "spark": 35,
    }


def test_normalize_allocation_caps_returns_none_for_invalid_non_strict_values() -> None:
    normalized = _normalize_allocation_caps(
        {
            "aave_v3": 120,
            "spark": "not-a-number",
        },
        strict=False,
    )

    assert normalized is None


def test_normalize_allocation_caps_raises_for_invalid_strict_values() -> None:
    with pytest.raises(
        ValueError,
        match=r"allocationCaps\[aave_v3\] must be an integer between 0 and 100",
    ):
        _normalize_allocation_caps({"aave_v3": -1}, strict=True)

    with pytest.raises(ValueError, match="Invalid protocol in allocationCaps"):
        _normalize_allocation_caps({"unknown": 20}, strict=True)


def test_scope_allocation_caps_prunes_protocols_outside_selected_scope() -> None:
    scoped = _scope_allocation_caps(
        {
            "aave_v3": 50,
            "spark": 30,
            "euler_v2": 20,
        },
        ["spark", "euler_v2"],
    )

    assert scoped == {
        "spark": 30,
        "euler_v2": 20,
    }


def test_effective_cap_total_pct_handles_partial_caps_without_forcing_100() -> None:
    # Missing cap entries are unbounded (100%) for their market.
    total = _effective_cap_total_pct(
        {
            "spark": 40,
            "euler_v2": 20,
        },
        ["spark", "euler_v2", "aave_v3"],
    )

    assert total == 160


def test_effective_cap_total_pct_can_be_below_100_for_selected_scope() -> None:
    # Edge case requested by product: selected caps may not add up to 100%.
    total = _effective_cap_total_pct(
        {
            "spark": 40,
            "euler_v2": 20,
            "aave_v3": 0,
        },
        ["spark", "euler_v2", "aave_v3"],
    )

    assert total == 60


def test_has_deployable_cap_detects_all_zero_scope() -> None:
    assert _has_deployable_cap(
        {
            "spark": 0,
            "euler_v2": 0,
        },
        ["spark", "euler_v2"],
    ) is False


def test_has_deployable_cap_true_when_caps_are_unset() -> None:
    assert _has_deployable_cap(None, ["spark", "euler_v2"]) is True
