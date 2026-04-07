from decimal import Decimal

from app.services.protocols.silo import _compute_silo_depositor_apr


def test_compute_silo_depositor_apr_matches_expected_formula() -> None:
    borrow_apr = Decimal("0.080005640948352")
    utilization = Decimal("0.8178354410868430417071991480")
    dao_fee_wad = Decimal("100000000000000000")  # 10%
    deployer_fee_wad = Decimal("0")

    apr = _compute_silo_depositor_apr(
        borrow_apr=borrow_apr,
        utilization=utilization,
        dao_fee_wad=dao_fee_wad,
        deployer_fee_wad=deployer_fee_wad,
    )

    # Expected from live Silo market arithmetic (~5.8888%).
    assert apr.quantize(Decimal("0.000000000000001")) == Decimal("0.058888303788988")


def test_compute_silo_depositor_apr_clamps_invalid_inputs() -> None:
    apr = _compute_silo_depositor_apr(
        borrow_apr=Decimal("0.10"),
        utilization=Decimal("1.5"),
        dao_fee_wad=Decimal("900000000000000000"),
        deployer_fee_wad=Decimal("900000000000000000"),
    )

    # Utilization clamps to 1 and total fees clamp to 100%, so depositor APR is 0.
    assert apr == Decimal("0")
