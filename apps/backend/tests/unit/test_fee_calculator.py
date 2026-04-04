"""Unit tests for the agent fee calculator.

Tests cover:
    1. Proportional fee on partial withdrawal (with profit)
    2. Full withdrawal — fee on entire profit
    3. Loss protection — no fee when balance < principal
    4. Fee-exempt account — fee is always zero
    5. net_principal update after withdrawal
    6. Zero-profit scenario — no fee when balance == principal
    7. Validation — negative/zero/exceeding withdraw amounts
    8. Custom fee rate override
    9. USDC precision (6 decimal quantization)
"""

import pytest
from decimal import Decimal
from unittest.mock import patch, MagicMock

from app.services.fee_calculator import (
    FeeCalculation,
    calculate_agent_fee,
    record_deposit,
    record_withdrawal,
)


D = Decimal


# ── Mock settings ────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def mock_settings():
    """Provide a settings mock with default 10% fee rate."""
    mock = MagicMock()
    mock.AGENT_FEE_RATE = 0.10
    with patch("app.services.fee_calculator.get_settings", return_value=mock):
        yield mock


# ── 1. Proportional fee on partial withdrawal ───────────────────────────────

def test_partial_withdrawal_proportional_fee():
    """50% withdrawal of an account with $100 profit → $5 fee."""
    result = calculate_agent_fee(
        withdraw_amount=D("500"),
        current_balance=D("1000"),
        net_principal=D("900"),
        fee_exempt=False,
    )
    # profit = 1000 - 900 = 100
    # proportion = 500 / 1000 = 0.5
    # attributable_profit = 100 * 0.5 = 50
    # agent_fee = 50 * 0.10 = 5
    assert result.accrued_profit == D("100")
    assert result.attributable_profit == D("50.000000")
    assert result.agent_fee == D("5.000000")
    assert result.user_receives == D("495.000000")
    assert result.fee_exempt is False
    assert result.fee_rate == D("0.1")


# ── 2. Full withdrawal ──────────────────────────────────────────────────────

def test_full_withdrawal_fee():
    """Withdraw entire balance — fee on all profit."""
    result = calculate_agent_fee(
        withdraw_amount=D("1100"),
        current_balance=D("1100"),
        net_principal=D("1000"),
        fee_exempt=False,
    )
    # profit = 1100 - 1000 = 100
    # proportion = 1100 / 1100 = 1.0
    # attributable_profit = 100 * 1.0 = 100
    # agent_fee = 100 * 0.10 = 10
    assert result.accrued_profit == D("100")
    assert result.attributable_profit == D("100.000000")
    assert result.agent_fee == D("10.000000")
    assert result.user_receives == D("1090.000000")


# ── 3. Loss protection — no fee when in loss ────────────────────────────────

def test_loss_protection_no_fee():
    """If balance < principal (loss), fee must be zero."""
    result = calculate_agent_fee(
        withdraw_amount=D("400"),
        current_balance=D("800"),
        net_principal=D("1000"),
        fee_exempt=False,
    )
    assert result.accrued_profit == D("0")
    assert result.attributable_profit == D("0.000000")
    assert result.agent_fee == D("0.000000")
    assert result.user_receives == D("400.000000")


# ── 4. Fee-exempt account ───────────────────────────────────────────────────

def test_fee_exempt_zero_fee():
    """Fee-exempt accounts pay zero fee even with profit."""
    result = calculate_agent_fee(
        withdraw_amount=D("500"),
        current_balance=D("1200"),
        net_principal=D("1000"),
        fee_exempt=True,
    )
    assert result.agent_fee == D("0")
    assert result.user_receives == D("500")
    assert result.fee_exempt is True
    assert result.fee_rate == D("0")
    assert result.accrued_profit == D("200")


# ── 5. net_principal update ─────────────────────────────────────────────────

def test_net_principal_update_with_fee():
    """new_net_principal = net_principal - user_receives."""
    result = calculate_agent_fee(
        withdraw_amount=D("500"),
        current_balance=D("1000"),
        net_principal=D("900"),
        fee_exempt=False,
    )
    # user_receives = 500 - 5 = 495
    # new_net_principal = 900 - 495 = 405
    assert result.new_net_principal == D("405.000000")


def test_net_principal_update_fee_exempt():
    """Fee-exempt: new_net_principal = net_principal - withdraw_amount."""
    result = calculate_agent_fee(
        withdraw_amount=D("500"),
        current_balance=D("1000"),
        net_principal=D("900"),
        fee_exempt=True,
    )
    assert result.new_net_principal == D("400")


# ── 6. Zero profit — balance equals principal ───────────────────────────────

def test_zero_profit_no_fee():
    """When balance == principal, no profit → no fee."""
    result = calculate_agent_fee(
        withdraw_amount=D("200"),
        current_balance=D("1000"),
        net_principal=D("1000"),
        fee_exempt=False,
    )
    assert result.accrued_profit == D("0")
    assert result.agent_fee == D("0.000000")
    assert result.user_receives == D("200.000000")


# ── 7. Validation — invalid inputs ──────────────────────────────────────────

def test_zero_withdraw_amount_raises():
    with pytest.raises(ValueError, match="positive"):
        calculate_agent_fee(
            withdraw_amount=D("0"),
            current_balance=D("1000"),
            net_principal=D("1000"),
            fee_exempt=False,
        )


def test_negative_withdraw_amount_raises():
    with pytest.raises(ValueError, match="positive"):
        calculate_agent_fee(
            withdraw_amount=D("-100"),
            current_balance=D("1000"),
            net_principal=D("1000"),
            fee_exempt=False,
        )


def test_withdraw_exceeds_balance_raises():
    with pytest.raises(ValueError, match="exceeds"):
        calculate_agent_fee(
            withdraw_amount=D("1500"),
            current_balance=D("1000"),
            net_principal=D("1000"),
            fee_exempt=False,
        )


def test_zero_balance_raises():
    with pytest.raises(ValueError, match="positive"):
        calculate_agent_fee(
            withdraw_amount=D("100"),
            current_balance=D("0"),
            net_principal=D("0"),
            fee_exempt=False,
        )


# ── 8. Custom fee rate ──────────────────────────────────────────────────────

def test_custom_fee_rate():
    """Override the default 10% with a custom rate."""
    result = calculate_agent_fee(
        withdraw_amount=D("1000"),
        current_balance=D("1000"),
        net_principal=D("800"),
        fee_exempt=False,
        fee_rate=D("0.20"),
    )
    # profit = 200, proportion = 1.0, attributable = 200
    # fee = 200 * 0.20 = 40
    assert result.agent_fee == D("40.000000")
    assert result.fee_rate == D("0.20")


# ── 9. USDC precision ───────────────────────────────────────────────────────

def test_usdc_six_decimal_precision():
    """Fees are quantized to 6 decimal places (USDC precision)."""
    result = calculate_agent_fee(
        withdraw_amount=D("333.333333"),
        current_balance=D("1000"),
        net_principal=D("900"),
        fee_exempt=False,
    )
    # proportion = 333.333333 / 1000 = 0.333333333
    # accrued = 100
    # attributable = 100 * 0.333333333 = 33.333333...
    # fee = 33.333333 * 0.10 = 3.333333...
    # Check quantization to 6 decimals
    assert result.agent_fee == result.agent_fee.quantize(D("0.000001"))
    assert result.user_receives == result.user_receives.quantize(D("0.000001"))
    assert result.attributable_profit == result.attributable_profit.quantize(D("0.000001"))


# ── 10. record_deposit ──────────────────────────────────────────────────────

def test_record_deposit_new_account():
    """record_deposit inserts a new tracking row for first deposit."""
    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    mock_db.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{}])

    record_deposit(mock_db, "acct-1", D("1000"))

    mock_db.table.return_value.insert.assert_called_once()
    call_args = mock_db.table.return_value.insert.call_args[0][0]
    assert call_args["account_id"] == "acct-1"
    assert call_args["cumulative_deposited"] == "1000"


def test_record_deposit_existing_account():
    """record_deposit increments cumulative_deposited for existing account."""
    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"cumulative_deposited": "500"}]
    )
    mock_db.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{}])

    record_deposit(mock_db, "acct-1", D("300"))

    mock_db.table.return_value.update.assert_called_once()
    call_args = mock_db.table.return_value.update.call_args[0][0]
    assert call_args["cumulative_deposited"] == "800"


# ── 11. record_withdrawal ───────────────────────────────────────────────────

def test_record_withdrawal_updates_cumulative():
    """record_withdrawal increments cumulative_net_withdrawn by user_receives."""
    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"cumulative_net_withdrawn": "200"}]
    )
    mock_db.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{}])

    fee_calc = FeeCalculation(
        withdraw_amount=D("500"),
        current_balance=D("1000"),
        net_principal=D("900"),
        accrued_profit=D("100"),
        attributable_profit=D("50"),
        agent_fee=D("5"),
        user_receives=D("495"),
        new_net_principal=D("405"),
        fee_exempt=False,
        fee_rate=D("0.10"),
    )
    record_withdrawal(mock_db, "acct-1", fee_calc)

    mock_db.table.return_value.update.assert_called_once()
    call_args = mock_db.table.return_value.update.call_args[0][0]
    # 200 + 495 = 695
    assert call_args["cumulative_net_withdrawn"] == "695"


def test_record_withdrawal_bootstraps_missing_tracking_row():
    """Missing yield-tracking rows are bootstrapped from current balance."""
    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[]
    )
    mock_db.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{}])

    fee_calc = FeeCalculation(
        withdraw_amount=D("500"),
        current_balance=D("1000"),
        net_principal=D("900"),
        accrued_profit=D("100"),
        attributable_profit=D("50"),
        agent_fee=D("5"),
        user_receives=D("495"),
        new_net_principal=D("405"),
        fee_exempt=False,
        fee_rate=D("0.10"),
    )

    record_withdrawal(mock_db, "acct-1", fee_calc)

    mock_db.table.return_value.insert.assert_called_once()
    call_args = mock_db.table.return_value.insert.call_args[0][0]
    assert call_args["account_id"] == "acct-1"
    assert call_args["cumulative_deposited"] == "1000"
    assert call_args["cumulative_net_withdrawn"] == "495"


# ── 12. Exploit prevention: fee never exceeds withdrawal ────────────────────

def test_fee_never_exceeds_withdrawal_amount():
    """Even with extreme profit, fee must be < withdraw_amount."""
    result = calculate_agent_fee(
        withdraw_amount=D("50"),
        current_balance=D("50"),
        net_principal=D("1"),  # Nearly all profit
        fee_exempt=False,
    )
    # profit = 49, proportion = 1.0, attributable = 49, fee = 4.9
    assert result.agent_fee < result.withdraw_amount
    assert result.user_receives > D("0")


def test_fee_never_negative():
    """Fee must always be >= 0, even with weird inputs."""
    result = calculate_agent_fee(
        withdraw_amount=D("100"),
        current_balance=D("500"),
        net_principal=D("1000"),  # Deep loss
        fee_exempt=False,
    )
    assert result.agent_fee >= D("0")
    assert result.user_receives == result.withdraw_amount


# ── 13. Tiny profit / dust amounts ──────────────────────────────────────────

def test_tiny_profit_dust_fee():
    """0.000001 USDC profit: fee should be 0.000000 (quantized to zero)."""
    result = calculate_agent_fee(
        withdraw_amount=D("100.000000"),
        current_balance=D("100.000001"),
        net_principal=D("100.000000"),
        fee_exempt=False,
    )
    # profit = 0.000001, proportion = ~1.0, attributable = ~0.000001
    # fee = 0.000001 * 0.10 = 0.0000001 → quantized to 0.000000
    assert result.agent_fee == D("0.000000")


def test_minimum_meaningful_fee():
    """Smallest fee that survives quantization is 0.000001."""
    # Need attributable_profit * 0.10 >= 0.0000005
    # attributable_profit >= 0.000005
    # With 100% proportion: accrued_profit >= 0.000005
    result = calculate_agent_fee(
        withdraw_amount=D("1"),
        current_balance=D("1"),
        net_principal=D("0.999990"),  # profit = 0.000010
        fee_exempt=False,
    )
    # fee = 0.000010 * 0.10 = 0.000001
    assert result.agent_fee == D("0.000001")


# ── 14. Sequential withdrawals: splitting costs more (protocol-favorable) ────

def test_sequential_withdrawals_cost_more_than_single():
    """
    Two 50% withdrawals yield MORE total fee than one 100% withdrawal.

    This is mathematically correct because new_net_principal = net_principal - user_receives,
    and user_receives < withdraw_amount (when there's a fee). This means the principal
    shrinks less than the withdrawal, inflating apparent profit for subsequent withdrawals.

    This is FAVORABLE for the protocol — users cannot exploit by splitting withdrawals.
    """
    # Full withdrawal
    full = calculate_agent_fee(
        withdraw_amount=D("1000"),
        current_balance=D("1000"),
        net_principal=D("800"),
        fee_exempt=False,
    )

    # First 50% withdrawal
    first = calculate_agent_fee(
        withdraw_amount=D("500"),
        current_balance=D("1000"),
        net_principal=D("800"),
        fee_exempt=False,
    )

    # After first withdrawal, balance = 500, net_principal = first.new_net_principal
    second = calculate_agent_fee(
        withdraw_amount=D("500"),
        current_balance=D("500"),
        net_principal=first.new_net_principal,
        fee_exempt=False,
    )

    # Total fees from splitting should be >= full withdrawal fee (protocol-favorable)
    total_fee = first.agent_fee + second.agent_fee
    assert total_fee >= full.agent_fee, (
        f"Split withdrawal fee ({total_fee}) < full withdrawal fee ({full.agent_fee}) — user exploit!"
    )


# ── 15. No float contamination ──────────────────────────────────────────────

def test_all_outputs_are_decimal():
    """Every numeric field in FeeCalculation must be Decimal, never float or int."""
    result = calculate_agent_fee(
        withdraw_amount=D("500"),
        current_balance=D("1000"),
        net_principal=D("900"),
        fee_exempt=False,
    )
    for field_name in [
        "withdraw_amount", "current_balance", "net_principal",
        "accrued_profit", "attributable_profit", "agent_fee",
        "user_receives", "new_net_principal", "fee_rate",
    ]:
        value = getattr(result, field_name)
        assert isinstance(value, Decimal), (
            f"{field_name} is {type(value).__name__}, expected Decimal"
        )


# ── 16. Extreme values ──────────────────────────────────────────────────────

def test_whale_withdrawal():
    """$10M withdrawal with $1M profit — ensures no overflow or precision loss."""
    result = calculate_agent_fee(
        withdraw_amount=D("10000000"),
        current_balance=D("10000000"),
        net_principal=D("9000000"),
        fee_exempt=False,
    )
    # profit = 1M, fee = 100K
    assert result.agent_fee == D("100000.000000")
    assert result.user_receives == D("9900000.000000")


def test_penny_withdrawal():
    """$0.01 USDC withdrawal (dust threshold)."""
    result = calculate_agent_fee(
        withdraw_amount=D("0.01"),
        current_balance=D("100"),
        net_principal=D("99"),
        fee_exempt=False,
    )
    # profit = 1, proportion = 0.0001, attributable = 0.0001
    # fee = 0.0001 * 0.10 = 0.00001 → quantized to 0.000010
    assert result.agent_fee >= D("0")
    assert result.user_receives > D("0")
