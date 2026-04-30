"""Unit tests for deposit-endpoint validation helpers in account routes."""

from decimal import Decimal

import pytest

from app.api.routes.accounts import _normalize_tx_hash, _parse_deposit_amount_usdc


def test_normalize_tx_hash_lowercases_valid_hash() -> None:
    tx_hash = _normalize_tx_hash(f"0x{'AB' * 32}")
    assert tx_hash == f"0x{'ab' * 32}"


def test_normalize_tx_hash_rejects_invalid_shape() -> None:
    with pytest.raises(ValueError, match="fundingTxHash"):
        _normalize_tx_hash("0x1234")


def test_parse_deposit_amount_usdc_accepts_valid_precision() -> None:
    parsed = _parse_deposit_amount_usdc("12.345678")
    assert parsed == Decimal("12.345678")


def test_parse_deposit_amount_usdc_rejects_invalid_decimal() -> None:
    with pytest.raises(ValueError, match="valid decimal string"):
        _parse_deposit_amount_usdc("abc")


def test_parse_deposit_amount_usdc_rejects_over_precision() -> None:
    with pytest.raises(ValueError, match="max 6 decimals"):
        _parse_deposit_amount_usdc("1.1234567")


def test_parse_deposit_amount_usdc_rejects_non_positive() -> None:
    with pytest.raises(ValueError, match="greater than 0"):
        _parse_deposit_amount_usdc("0")


def test_parse_deposit_amount_usdc_rejects_above_cap() -> None:
    with pytest.raises(ValueError, match="exceeds maximum"):
        _parse_deposit_amount_usdc("10000000.000001")
