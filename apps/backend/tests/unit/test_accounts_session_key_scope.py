"""Unit tests for session-key protocol scope resolution in account routes."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.api.routes.accounts import (
    _DEFAULT_ALLOWED_PROTOCOLS,
    _find_excluded_funded_protocols,
    _find_excluded_funded_protocols_onchain,
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


def _build_db_with_allocations(rows: list[dict]):
    db = MagicMock()
    query = db.table.return_value
    query.select.return_value = query
    query.eq.return_value = query
    query.execute.return_value = MagicMock(data=rows)
    return db


def test_find_excluded_funded_protocols_returns_missing_positive_allocations() -> None:
    db = _build_db_with_allocations(
        [
            {"protocol_id": "silo_savusd_usdc", "amount_usdc": "1.00"},
            {"protocol_id": "spark", "amount_usdc": "0"},
        ]
    )

    excluded = _find_excluded_funded_protocols(
        db,
        "acct-1",
        ["aave_v3", "benqi", "spark"],
    )

    assert excluded == ["silo_savusd_usdc"]


def test_find_excluded_funded_protocols_ignores_dust_and_invalid_amounts() -> None:
    db = _build_db_with_allocations(
        [
            {"protocol_id": "euler_v2", "amount_usdc": "0.0000001"},
            {"protocol_id": "benqi", "amount_usdc": "not-a-number"},
            {"protocol_id": "aave", "amount_usdc": "4"},
        ]
    )

    excluded = _find_excluded_funded_protocols(
        db,
        "acct-1",
        ["aave_v3", "spark"],
    )

    assert excluded == []


@pytest.mark.asyncio
async def test_find_excluded_funded_protocols_onchain_detects_excluded_balance(monkeypatch) -> None:
    class _Adapter:
        def __init__(self, balance_wei: int):
            self.balance_wei = balance_wei

        async def get_user_balance(self, _address: str, _asset: str) -> int:
            return self.balance_wei

    balances = {
        "euler_v2": int(1_500_000),  # 1.5 USDC
        "silo_susdp_usdc": int(0),
    }

    monkeypatch.setattr(
        "app.api.routes.accounts.get_settings",
        lambda: SimpleNamespace(USDC_ADDRESS="0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"),
    )
    monkeypatch.setattr(
        "app.api.routes.accounts.get_adapter",
        lambda pid: _Adapter(balances.get(pid, 0)),
    )

    excluded = await _find_excluded_funded_protocols_onchain(
        "0x0000000000000000000000000000000000000001",
        ["aave_v3", "benqi", "spark", "silo_susdp_usdc"],
    )

    assert excluded == ["euler_v2"]


@pytest.mark.asyncio
async def test_find_excluded_funded_protocols_onchain_raises_on_read_failure(monkeypatch) -> None:
    class _FailingAdapter:
        async def get_user_balance(self, _address: str, _asset: str) -> int:
            raise RuntimeError("rpc unavailable")

    monkeypatch.setattr(
        "app.api.routes.accounts.get_settings",
        lambda: SimpleNamespace(USDC_ADDRESS="0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"),
    )
    monkeypatch.setattr(
        "app.api.routes.accounts.get_adapter",
        lambda _pid: _FailingAdapter(),
    )

    with pytest.raises(RuntimeError):
        await _find_excluded_funded_protocols_onchain(
            "0x0000000000000000000000000000000000000001",
            ["aave_v3"],
        )
