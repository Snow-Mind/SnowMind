from decimal import Decimal

from app.services.protocols.folks import FolksAdapter


def test_folks_hourly_compounded_apy_from_annual_rate() -> None:
    annual_rate = Decimal("0.03")
    apy = FolksAdapter._compute_hourly_compounded_apy(annual_rate)

    # 3.0% APR compounded hourly is ~3.0454% APY.
    assert apy.quantize(Decimal("0.000001")) == Decimal("0.030454")


def test_folks_hourly_compounded_apy_non_positive_rate() -> None:
    assert FolksAdapter._compute_hourly_compounded_apy(Decimal("0")) == Decimal("0")
    assert FolksAdapter._compute_hourly_compounded_apy(Decimal("-0.1")) == Decimal("0")


def test_folks_hourly_compounded_apy_remains_finite_for_reasonable_input() -> None:
    apy = FolksAdapter._compute_hourly_compounded_apy(Decimal("0.50"))
    assert apy.is_finite()
    assert apy > Decimal("0.50")
