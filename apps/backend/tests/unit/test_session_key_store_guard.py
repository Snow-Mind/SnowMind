"""Unit tests for session-key renewal guard behavior."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.services.execution.session_key import (
    is_session_key_expiry_valid,
    store_session_key,
)


def _build_db(execute_results: list[MagicMock]):
    db = MagicMock()
    query = MagicMock()
    db.table.return_value = query

    query.select.return_value = query
    query.eq.return_value = query
    query.gte.return_value = query
    query.order.return_value = query
    query.limit.return_value = query
    query.update.return_value = query
    query.insert.return_value = query
    query.execute.side_effect = execute_results

    return db, query


def test_store_session_key_guard_blocks_same_key_when_not_forced() -> None:
    now = datetime.now(timezone.utc)
    existing_expires = (now + timedelta(days=10)).isoformat()

    db, _ = _build_db([
        MagicMock(data=[{"expires_at": existing_expires, "key_address": "0xabc123"}]),
    ])

    with patch("app.services.execution.session_key.encrypt_session_key", return_value="encrypted"):
        with pytest.raises(ValueError, match="Renewal not needed"):
            store_session_key(
                db,
                uuid4(),
                {
                    "serializedPermission": "perm-v1",
                    "sessionPrivateKey": "0xpriv",
                    "sessionKeyAddress": "0xabc123",
                    "expiresAt": int((now + timedelta(days=30)).timestamp()),
                },
                force=False,
            )


def test_store_session_key_allows_explicit_regrant_when_key_changes() -> None:
    now = datetime.now(timezone.utc)
    existing_expires = (now + timedelta(days=10)).isoformat()

    db, query = _build_db([
        MagicMock(data=[{"expires_at": existing_expires, "key_address": "0xoldkey"}]),
        MagicMock(data=[{"id": "old-key"}]),
        MagicMock(data=[{"id": "new-key-id"}]),
    ])

    with patch("app.services.execution.session_key.encrypt_session_key", return_value="encrypted"):
        new_key_id = store_session_key(
            db,
            uuid4(),
            {
                "serializedPermission": "perm-v2",
                "sessionPrivateKey": "0xpriv2",
                "sessionKeyAddress": "0xnewkey",
                "expiresAt": int((now + timedelta(days=30)).timestamp()),
            },
            force=False,
        )

    assert new_key_id == "new-key-id"
    assert query.update.called
    assert query.insert.called


def test_session_key_expiry_validator_accepts_iso_and_epoch_seconds() -> None:
    future_iso = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    future_epoch_seconds = int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp())

    assert is_session_key_expiry_valid(future_iso)
    assert is_session_key_expiry_valid(future_epoch_seconds)


def test_session_key_expiry_validator_accepts_epoch_milliseconds() -> None:
    future_epoch_ms = int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp() * 1000)
    assert is_session_key_expiry_valid(future_epoch_ms)


def test_session_key_expiry_validator_rejects_invalid_values() -> None:
    assert not is_session_key_expiry_valid("not-a-date")
    assert not is_session_key_expiry_valid(None)
