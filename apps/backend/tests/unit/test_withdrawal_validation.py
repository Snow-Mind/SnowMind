"""Unit tests for withdrawal input validation hardening.

Tests cover:
    1. Minimum amount rejection (< 0.000001 USDC)
    2. Maximum withdrawal rejection (> $10M)
    3. USDC precision enforcement (max 6 decimals)
    4. Invalid decimal strings
    5. Valid amounts pass through
"""

import pytest
from decimal import Decimal
from pydantic import ValidationError


def test_dust_amount_rejected():
    """Withdrawal below 1 micro-USDC must be rejected."""
    from app.api.routes.withdrawal import WithdrawalExecuteRequest

    with pytest.raises(ValidationError, match="below minimum"):
        WithdrawalExecuteRequest(
            smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
            withdrawAmount="0.0000001",
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
    """Exactly 1 micro-USDC should pass."""
    from app.api.routes.withdrawal import WithdrawalExecuteRequest

    req = WithdrawalExecuteRequest(
        smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
        withdrawAmount="0.000001",
    )
    assert req.withdraw_amount == "0.000001"


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

    with pytest.raises(ValidationError, match="below minimum"):
        WithdrawalPreviewRequest(
            smartAccountAddress="0x1234567890abcdef1234567890abcdef12345678",
            withdrawAmount="0.0000001",
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


def test_requested_amount_at_or_above_balance_normalizes_to_full():
    """Stale frontend amounts slightly above current balance should become full withdrawal."""
    from app.api.routes.withdrawal import _resolve_withdrawal_intent

    normalized_amount, is_full = _resolve_withdrawal_intent(
        requested_amount_usdc=Decimal("100.000001"),
        current_balance_usdc=Decimal("100"),
        requested_full_withdrawal=False,
    )

    assert is_full is True
    assert normalized_amount == Decimal("100")


def test_withdrawal_quote_guard_recomputes_if_raw_total_exceeds_onchain():
    """Quote should be recomputed when quantized transfers exceed on-chain balance."""
    from app.api.routes.withdrawal import _ensure_withdrawal_quote_within_onchain_balance
    from app.services.fee_calculator import FeeCalculation

    over_quoted = FeeCalculation(
        withdraw_amount=Decimal("100.000001"),
        current_balance=Decimal("100"),
        net_principal=Decimal("100"),
        accrued_profit=Decimal("0"),
        attributable_profit=Decimal("0"),
        agent_fee=Decimal("0"),
        user_receives=Decimal("100.000001"),
        new_net_principal=Decimal("0"),
        fee_exempt=True,
        fee_rate=Decimal("0"),
    )

    normalized = _ensure_withdrawal_quote_within_onchain_balance(
        fee_calc=over_quoted,
        current_balance_usdc=Decimal("100"),
        account={"fee_exempt": True, "address": "0x123"},
        yield_tracking=None,
    )

    assert normalized.user_receives == Decimal("100")
    assert normalized.agent_fee == Decimal("0")


def test_withdrawal_quote_guard_keeps_valid_quote_unchanged():
    """Already-safe quote should pass through unchanged."""
    from app.api.routes.withdrawal import _ensure_withdrawal_quote_within_onchain_balance
    from app.services.fee_calculator import FeeCalculation

    safe_quote = FeeCalculation(
        withdraw_amount=Decimal("50"),
        current_balance=Decimal("100"),
        net_principal=Decimal("100"),
        accrued_profit=Decimal("0"),
        attributable_profit=Decimal("0"),
        agent_fee=Decimal("0"),
        user_receives=Decimal("50"),
        new_net_principal=Decimal("50"),
        fee_exempt=True,
        fee_rate=Decimal("0"),
    )

    normalized = _ensure_withdrawal_quote_within_onchain_balance(
        fee_calc=safe_quote,
        current_balance_usdc=Decimal("100"),
        account={"fee_exempt": True, "address": "0x123"},
        yield_tracking=None,
    )

    assert normalized.user_receives == Decimal("50")
    assert normalized.agent_fee == Decimal("0")


def test_conservative_erc4626_assets_prefers_preview_when_lower():
    from app.api.routes.withdrawal import _conservative_erc4626_assets

    assert _conservative_erc4626_assets(808148, 808147) == 808147


def test_conservative_erc4626_assets_falls_back_to_convert_when_preview_missing():
    from app.api.routes.withdrawal import _conservative_erc4626_assets

    assert _conservative_erc4626_assets(808148, None) == 808148


def test_conservative_erc4626_shares_prefers_max_redeem_when_lower():
    from app.api.routes.withdrawal import _conservative_erc4626_shares

    assert _conservative_erc4626_shares(1_000_000, 900_000) == 900_000


def test_conservative_erc4626_shares_keeps_requested_when_max_missing():
    from app.api.routes.withdrawal import _conservative_erc4626_shares

    assert _conservative_erc4626_shares(1_000_000, None) == 1_000_000


def test_cap_benqi_redeemable_shares_limited_by_pool_cash():
    from app.api.routes.withdrawal import _cap_benqi_redeemable_shares

    # exchange rate = 2e18 => each qi redeem needs 2 underlying units
    capped = _cap_benqi_redeemable_shares(
        user_qi_shares=1_000,
        cash_raw=1_500,
        exchange_rate_raw=2 * 10**18,
    )
    assert capped == 750
