"""Unit tests for withdrawal input validation hardening.

Tests cover:
    1. Dust threshold rejection (< $0.01)
    2. Maximum withdrawal rejection (> $10M)
    3. USDC precision enforcement (max 6 decimals)
    4. Invalid decimal strings
    5. Valid amounts pass through
"""

import pytest
from decimal import Decimal
from pydantic import ValidationError


def test_dust_amount_rejected():
    """Withdrawal below $0.01 must be rejected."""
    from app.api.routes.withdrawal import WithdrawalExecuteRequest

    with pytest.raises(ValidationError, match="dust threshold"):
        WithdrawalExecuteRequest(
            smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
            withdrawAmount="0.001",
        )


def test_maximum_amount_rejected():
    """Withdrawal above $10M must be rejected."""
    from app.api.routes.withdrawal import WithdrawalExecuteRequest

    with pytest.raises(ValidationError, match="exceeds maximum"):
        WithdrawalExecuteRequest(
            smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
            withdrawAmount="99999999",
        )


def test_excess_precision_rejected():
    """More than 6 decimal places must be rejected."""
    from app.api.routes.withdrawal import WithdrawalExecuteRequest

    with pytest.raises(ValidationError, match="precision"):
        WithdrawalExecuteRequest(
            smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
            withdrawAmount="100.0000001",
        )


def test_invalid_decimal_string_rejected():
    """Non-numeric strings must be rejected."""
    from app.api.routes.withdrawal import WithdrawalExecuteRequest

    with pytest.raises(ValidationError, match="valid decimal"):
        WithdrawalExecuteRequest(
            smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
            withdrawAmount="not_a_number",
        )


def test_valid_amount_passes():
    """A normal withdrawal amount should pass validation."""
    from app.api.routes.withdrawal import WithdrawalExecuteRequest

    req = WithdrawalExecuteRequest(
        smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
        withdrawAmount="500.123456",
    )
    assert req.withdraw_amount == "500.123456"


def test_minimum_valid_amount():
    """Exactly $0.01 should pass (equal to dust threshold)."""
    from app.api.routes.withdrawal import WithdrawalExecuteRequest

    req = WithdrawalExecuteRequest(
        smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
        withdrawAmount="0.01",
    )
    assert req.withdraw_amount == "0.01"


def test_maximum_valid_amount():
    """Exactly $10M should pass."""
    from app.api.routes.withdrawal import WithdrawalExecuteRequest

    req = WithdrawalExecuteRequest(
        smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
        withdrawAmount="10000000",
    )
    assert req.withdraw_amount == "10000000"


def test_preview_request_same_validation():
    """WithdrawalPreviewRequest should have the same validation rules."""
    from app.api.routes.withdrawal import WithdrawalPreviewRequest

    with pytest.raises(ValidationError, match="dust threshold"):
        WithdrawalPreviewRequest(
            smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
            withdrawAmount="0.001",
        )

    with pytest.raises(ValidationError, match="exceeds maximum"):
        WithdrawalPreviewRequest(
            smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
            withdrawAmount="99999999",
        )


def test_infer_full_withdrawal_when_remaining_is_dust():
    """Leaving <= $0.01 should be treated as full withdrawal."""
    from app.api.routes.withdrawal import _resolve_withdrawal_intent

    normalized_amount, is_full = _resolve_withdrawal_intent(
        requested_amount_usdc=Decimal("99.995"),
        current_balance_usdc=Decimal("100"),
        requested_full_withdrawal=False,
    )

    assert is_full is True
    assert normalized_amount == Decimal("100")


def test_partial_withdrawal_remains_partial_above_dust_remainder():
    """Leaving > $0.01 should remain a partial withdrawal."""
    from app.api.routes.withdrawal import _resolve_withdrawal_intent

    normalized_amount, is_full = _resolve_withdrawal_intent(
        requested_amount_usdc=Decimal("99.97"),
        current_balance_usdc=Decimal("100"),
        requested_full_withdrawal=False,
    )

    assert is_full is False
    assert normalized_amount == Decimal("99.97")


def test_explicit_full_withdrawal_always_uses_current_balance():
    """Explicit full withdrawal should normalize to full balance."""
    from app.api.routes.withdrawal import _resolve_withdrawal_intent

    normalized_amount, is_full = _resolve_withdrawal_intent(
        requested_amount_usdc=Decimal("10"),
        current_balance_usdc=Decimal("100"),
        requested_full_withdrawal=True,
    )

    assert is_full is True
    assert normalized_amount == Decimal("100")
