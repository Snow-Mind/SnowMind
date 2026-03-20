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
