"""Unit tests for authentication and account ownership checks."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.core.security import require_privy_auth, verify_account_ownership


OWNER_ADDRESS = "0x1111111111111111111111111111111111111111"
OTHER_ADDRESS = "0x2222222222222222222222222222222222222222"


def _claims(owner_address: str, did: str = "did:privy:user-1") -> dict:
    return {
        "sub": did,
        "linked_accounts": [
            {
                "type": "wallet",
                "address": owner_address,
            }
        ],
    }


def _claims_without_wallet(did: str = "did:privy:user-1") -> dict:
    return {
        "sub": did,
    }


def _db_mock() -> tuple[MagicMock, MagicMock]:
    db = MagicMock()
    table = MagicMock()
    db.table.return_value = table
    table.update.return_value = table
    table.eq.return_value = table
    table.execute.return_value = MagicMock(data=[])
    return db, table


@pytest.mark.asyncio
async def test_require_privy_auth_rejects_missing_header() -> None:
    with pytest.raises(HTTPException) as exc:
        await require_privy_auth(None)

    assert exc.value.status_code == 401


def test_verify_account_ownership_allows_matching_did_and_wallet() -> None:
    claims = _claims(OWNER_ADDRESS)
    account = {
        "id": "acc-1",
        "address": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "owner_address": OWNER_ADDRESS,
        "privy_did": "did:privy:user-1",
    }
    db, table = _db_mock()

    verify_account_ownership(claims, account, db=db)

    table.update.assert_not_called()


def test_verify_account_ownership_rejects_did_mismatch() -> None:
    claims = _claims(OWNER_ADDRESS, did="did:privy:caller")
    account = {
        "id": "acc-1",
        "address": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "owner_address": OWNER_ADDRESS,
        "privy_did": "did:privy:owner",
    }

    with pytest.raises(HTTPException) as exc:
        verify_account_ownership(claims, account)

    assert exc.value.status_code == 403


def test_verify_account_ownership_rejects_wallet_mismatch() -> None:
    claims = _claims(OTHER_ADDRESS)
    account = {
        "id": "acc-1",
        "address": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "owner_address": OWNER_ADDRESS,
        "privy_did": "did:privy:user-1",
    }

    with pytest.raises(HTTPException) as exc:
        verify_account_ownership(claims, account)

    assert exc.value.status_code == 403


def test_verify_account_ownership_allows_did_match_without_wallet_claims() -> None:
    claims = _claims_without_wallet(did="did:privy:user-1")
    account = {
        "id": "acc-1",
        "address": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "owner_address": OWNER_ADDRESS,
        "privy_did": "did:privy:user-1",
    }

    verify_account_ownership(claims, account)


def test_verify_account_ownership_backfills_legacy_did_once() -> None:
    claims = _claims(OWNER_ADDRESS, did="did:privy:new")
    account = {
        "id": "acc-legacy",
        "address": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "owner_address": OWNER_ADDRESS,
        "privy_did": None,
    }
    db, table = _db_mock()

    verify_account_ownership(claims, account, db=db)

    table.update.assert_called_once_with({"privy_did": "did:privy:new"})
