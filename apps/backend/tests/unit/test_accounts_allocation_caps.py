import pytest

from app.api.routes.accounts import _normalize_allocation_caps


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
