from decimal import Decimal

from app.services.protocols.spark import _ray_per_second_to_apy


def test_ray_per_second_to_apy_matches_spark_vsr_target() -> None:
    # Live spUSDC VSR probe from chain should map to 3.75% APY.
    vsr = Decimal("1000000001167363430498603315")
    apy = _ray_per_second_to_apy(vsr)
    assert (apy * Decimal("100")).quantize(Decimal("0.01")) == Decimal("3.75")


def test_ray_per_second_to_apy_clamps_non_positive_inputs() -> None:
    assert _ray_per_second_to_apy(Decimal("0")) == Decimal("0")
    assert _ray_per_second_to_apy(Decimal("-1")) == Decimal("0")
