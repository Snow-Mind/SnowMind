"""Unit tests for the rate fetcher."""

from decimal import Decimal

from app.services.optimizer.rate_fetcher import RateFetcher
from app.services.protocols.base import ProtocolRate


def _build_rate(*, apy: Decimal, effective_apy: Decimal | None = None, tvl_usd: Decimal = Decimal("1000000")) -> ProtocolRate:
    return ProtocolRate(
        protocol_id="test_protocol",
        apy=apy,
        effective_apy=effective_apy if effective_apy is not None else apy,
        tvl_usd=tvl_usd,
    )


def test_validate_rate_accepts_finite_reasonable_values() -> None:
    rate = _build_rate(apy=Decimal("0.052"), effective_apy=Decimal("0.051"))
    assert RateFetcher.validate_rate(rate) is True


def test_validate_rate_rejects_non_finite_values() -> None:
    inf_apy = _build_rate(apy=Decimal("Infinity"), effective_apy=Decimal("Infinity"))
    nan_tvl = _build_rate(apy=Decimal("0.05"), effective_apy=Decimal("0.05"), tvl_usd=Decimal("NaN"))

    assert RateFetcher.validate_rate(inf_apy) is False
    assert RateFetcher.validate_rate(nan_tvl) is False


def test_validate_rate_rejects_out_of_bounds_values() -> None:
    excessive_apy = _build_rate(apy=Decimal("2.5"), effective_apy=Decimal("2.5"))
    negative_effective = _build_rate(apy=Decimal("0.05"), effective_apy=Decimal("-0.01"))

    assert RateFetcher.validate_rate(excessive_apy) is False
    assert RateFetcher.validate_rate(negative_effective) is False
