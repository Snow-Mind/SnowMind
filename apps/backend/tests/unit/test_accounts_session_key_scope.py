"""Unit tests for session-key protocol scope resolution in account routes."""

from unittest.mock import MagicMock

from app.api.routes.accounts import (
    _DEFAULT_ALLOWED_PROTOCOLS,
    _normalize_allowed_protocols,
    _resolve_allowed_protocols,
)


def _build_db_with_latest_protocols(latest_protocols: list[str] | None):
    db = MagicMock()
    query = db.table.return_value
    query.select.return_value = query
    query.eq.return_value = query
    query.order.return_value = query
    query.limit.return_value = query
    query.execute.return_value = MagicMock(
        data=[{"allowed_protocols": latest_protocols}] if latest_protocols is not None else []
    )
    return db


def test_normalize_allowed_protocols_dedupes_and_canonicalizes() -> None:
    normalized = _normalize_allowed_protocols([
        "AAVE",
        "aave_v3",
        "BENQI",
        "unknown",
        "",
        "spark",
        "spark",
    ])

    assert normalized == ["aave_v3", "benqi", "spark"]


def test_resolve_uses_requested_scope_when_provided() -> None:
    db = _build_db_with_latest_protocols(["benqi"])  # should be ignored

    resolved = _resolve_allowed_protocols(db, "acct-1", ["spark", "aave"])

    assert resolved == ["spark", "aave_v3"]


def test_resolve_reuses_latest_scope_when_request_omits_scope() -> None:
    db = _build_db_with_latest_protocols(["silo_susdp_usdc", "AAVE"])

    resolved = _resolve_allowed_protocols(db, "acct-1", None)

    assert resolved == ["silo_susdp_usdc", "aave_v3"]


def test_resolve_falls_back_to_default_scope_when_no_history() -> None:
    db = _build_db_with_latest_protocols(None)

    resolved = _resolve_allowed_protocols(db, "acct-1", None)

    assert resolved == list(_DEFAULT_ALLOWED_PROTOCOLS)


def test_resolve_falls_back_to_default_when_history_invalid() -> None:
    db = _build_db_with_latest_protocols(["", "not_a_protocol"])

    resolved = _resolve_allowed_protocols(db, "acct-1", None)

    assert resolved == list(_DEFAULT_ALLOWED_PROTOCOLS)
