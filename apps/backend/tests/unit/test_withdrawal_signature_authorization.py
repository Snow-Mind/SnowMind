"""Unit tests for withdrawal authorization signature checks."""

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException

from app.api.routes.withdrawal import (
    WithdrawalExecuteRequest,
    _build_withdrawal_authorization_message,
    _can_deactivate_after_full_withdrawal,
    _verify_withdrawal_authorization,
)


def _base_request(**overrides) -> WithdrawalExecuteRequest:
    payload = {
        "smartAccountAddress": "0x1234567890abcdef1234567890abcdef12345678",
        "withdrawAmount": "1.000000",
        "isFullWithdrawal": True,
        "ownerSignature": "0x",
        "signatureMessage": "",
        "signatureTimestamp": int(datetime.now(timezone.utc).timestamp()),
    }
    payload.update(overrides)
    return WithdrawalExecuteRequest(**payload)


def test_missing_signature_payload_rejected() -> None:
    req = _base_request(ownerSignature=None, signatureMessage=None, signatureTimestamp=None)
    account = {"owner_address": "0x1111111111111111111111111111111111111111"}

    with pytest.raises(HTTPException) as exc:
        _verify_withdrawal_authorization(req, account)

    assert exc.value.status_code == 400
    assert "authorization signature is required" in str(exc.value.detail)


def test_signature_message_mismatch_rejected() -> None:
    req = _base_request(
        ownerSignature="0xdeadbeef",
        signatureMessage="tampered",
    )
    account = {"owner_address": "0x1111111111111111111111111111111111111111"}

    with pytest.raises(HTTPException) as exc:
        _verify_withdrawal_authorization(req, account)

    assert exc.value.status_code == 400
    assert "payload mismatch" in str(exc.value.detail)


def test_owner_mismatch_rejected() -> None:
    signer = Account.create()
    req = _base_request()
    account = {"owner_address": "0x2222222222222222222222222222222222222222"}

    msg = _build_withdrawal_authorization_message(
        smart_account_address=req.smart_account_address,
        owner_address=account["owner_address"],
        withdraw_amount_raw=1_000_000,
        is_full_withdrawal=True,
        signature_timestamp=req.signature_timestamp or 0,
    )
    sig = signer.sign_message(encode_defunct(text=msg)).signature.hex()
    req = _base_request(
        ownerSignature=f"0x{sig}",
        signatureMessage=msg,
    )

    with pytest.raises(HTTPException) as exc:
        _verify_withdrawal_authorization(req, account)

    assert exc.value.status_code == 403


def test_future_timestamp_rejected() -> None:
    signer = Account.create()
    ts = int(datetime.now(timezone.utc).timestamp()) + 120

    msg = _build_withdrawal_authorization_message(
        smart_account_address="0x1234567890abcdef1234567890abcdef12345678",
        owner_address=signer.address,
        withdraw_amount_raw=1_000_000,
        is_full_withdrawal=True,
        signature_timestamp=ts,
    )
    sig = signer.sign_message(encode_defunct(text=msg)).signature.hex()

    req = _base_request(
        ownerSignature=f"0x{sig}",
        signatureMessage=msg,
        signatureTimestamp=ts,
    )
    account = {"owner_address": signer.address}

    with pytest.raises(HTTPException) as exc:
        _verify_withdrawal_authorization(req, account)

    assert exc.value.status_code == 401
    assert "too far in the future" in str(exc.value.detail)


def test_valid_signature_passes() -> None:
    signer = Account.create()
    ts = int(datetime.now(timezone.utc).timestamp())

    msg = _build_withdrawal_authorization_message(
        smart_account_address="0x1234567890abcdef1234567890abcdef12345678",
        owner_address=signer.address,
        withdraw_amount_raw=1_000_000,
        is_full_withdrawal=True,
        signature_timestamp=ts,
    )
    sig = signer.sign_message(encode_defunct(text=msg)).signature.hex()

    req = _base_request(
        ownerSignature=f"0x{sig}",
        signatureMessage=msg,
        signatureTimestamp=ts,
    )
    account = {"owner_address": signer.address}

    _verify_withdrawal_authorization(req, account)


def test_can_deactivate_after_full_withdrawal_when_empty_and_complete() -> None:
    assert _can_deactivate_after_full_withdrawal(
        post_withdraw_total_usdc=Decimal("0.009999"),
        balance_check_complete=True,
    )


def test_cannot_deactivate_after_full_withdrawal_when_residual_balance_remains() -> None:
    assert not _can_deactivate_after_full_withdrawal(
        post_withdraw_total_usdc=Decimal("0.500000"),
        balance_check_complete=True,
    )


def test_cannot_deactivate_after_full_withdrawal_when_balance_check_incomplete() -> None:
    assert not _can_deactivate_after_full_withdrawal(
        post_withdraw_total_usdc=Decimal("0.000000"),
        balance_check_complete=False,
    )
