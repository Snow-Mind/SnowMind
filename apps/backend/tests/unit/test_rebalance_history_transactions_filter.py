"""Unit tests for rebalance history transaction-only filtering."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from starlette.requests import Request

from app.api.routes import rebalance


@pytest.fixture(autouse=True)
def _stub_tx_receipt_lookup(monkeypatch):
    """Keep unit tests deterministic by disabling live receipt lookups."""
    monkeypatch.setattr(
        rebalance,
        "_tx_receipt_succeeded",
        AsyncMock(return_value=None),
    )


class _FakeRebalanceLogsQuery:
    def __init__(self, *, count: int | None = None, rows: list[dict] | None = None):
        self._count = count
        self._rows = rows or []
        self.eq_calls: list[tuple[str, str]] = []
        self.neq_calls: list[tuple[str, str]] = []

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, field: str, value: str):
        self.eq_calls.append((field, value))
        return self

    def neq(self, field: str, value: str):
        self.neq_calls.append((field, value))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self._count is not None:
            return SimpleNamespace(count=self._count, data=[])
        return SimpleNamespace(data=self._rows)


class _FakeDB:
    def __init__(self):
        self._count_query = _FakeRebalanceLogsQuery(count=1)
        self._rows_query = _FakeRebalanceLogsQuery(rows=[
            {
                "id": "00000000-0000-0000-0000-000000000001",
                "status": "executed",
                "skip_reason": None,
                "from_protocol": "user_wallet",
                "to_protocol": "idle",
                "amount_moved": "50.000000",
                "proposed_allocations": None,
                "executed_allocations": {"idle": "50.000000"},
                "apr_improvement": None,
                "gas_cost_usd": None,
                "tx_hash": "0xabc",
                "created_at": "2026-04-01T00:00:00Z",
            }
        ])
        self._table_calls = 0

    def table(self, name: str):
        assert name == "rebalance_logs"
        self._table_calls += 1
        return self._count_query if self._table_calls == 1 else self._rows_query


@pytest.mark.asyncio
async def test_get_rebalance_history_applies_transactions_only_filter(monkeypatch) -> None:
    """transactionsOnly=true must fetch only executed transaction logs."""
    db = _FakeDB()

    async def _fake_lookup_account(_db, _address, _auth):
        return {"id": "acct-1", "address": "0xabc"}

    monkeypatch.setattr(rebalance, "_lookup_account", _fake_lookup_account)

    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/api/v1/rebalance/0xabc/history",
        "headers": [],
    })

    result = await rebalance.get_rebalance_history(
        request=request,
        address="0xabc",
        db=db,
        _auth={"sub": "did:privy:test"},
        limit=10,
        offset=0,
        transactions_only=True,
    )

    assert result.total == 1
    assert len(result.logs) == 1
    assert ("status", "executed") in db._count_query.eq_calls
    assert ("status", "executed") in db._rows_query.eq_calls


@pytest.mark.asyncio
async def test_get_rebalance_history_sanitizes_legacy_rows(monkeypatch) -> None:
    """Malformed legacy rows should not fail the endpoint with a 400."""

    class _LegacyRowsDB:
        def __init__(self):
            self._count_query = _FakeRebalanceLogsQuery(count=2)
            self._rows_query = _FakeRebalanceLogsQuery(rows=[
                {
                    # Legacy shape with unknown status and JSON string payloads.
                    "id": "00000000-0000-0000-0000-000000000002",
                    "status": "completed_with_notes",
                    "skip_reason": None,
                    "from_protocol": "idle",
                    "to_protocol": "benqi",
                    "amount_moved": 50.0,
                    "proposed_allocations": '{"benqi":"50.0"}',
                    "executed_allocations": '{"benqi":"50.0"}',
                    "apr_improvement": "0.001",
                    "gas_cost_usd": "0.05",
                    "tx_hash": None,
                    "created_at": "2026-04-01T00:00:00Z",
                },
                {
                    # Irrecoverable shape; endpoint should skip this row.
                    "id": "not-a-uuid",
                    "status": "executed",
                    "created_at": "2026-04-01T00:00:00Z",
                },
            ])
            self._table_calls = 0

        def table(self, name: str):
            assert name == "rebalance_logs"
            self._table_calls += 1
            return self._count_query if self._table_calls == 1 else self._rows_query

    db = _LegacyRowsDB()

    async def _fake_lookup_account(_db, _address, _auth):
        return {"id": "acct-legacy", "address": "0xabc"}

    monkeypatch.setattr(rebalance, "_lookup_account", _fake_lookup_account)

    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/api/v1/rebalance/0xabc/history",
        "headers": [],
    })

    result = await rebalance.get_rebalance_history(
        request=request,
        address="0xabc",
        db=db,
        _auth={"sub": "did:privy:test"},
        limit=10,
        offset=0,
        transactions_only=True,
    )

    assert result.total == 2
    assert len(result.logs) == 0


@pytest.mark.asyncio
async def test_get_rebalance_history_backfills_executed_metadata(monkeypatch) -> None:
    """Executed rows missing amount/protocol fields should be normalized for transaction UIs."""

    class _MissingMetadataDB:
        def __init__(self):
            self._count_query = _FakeRebalanceLogsQuery(count=1)
            self._rows_query = _FakeRebalanceLogsQuery(rows=[
                {
                    "id": "00000000-0000-0000-0000-000000000010",
                    "status": "executed",
                    "skip_reason": None,
                    "from_protocol": None,
                    "to_protocol": None,
                    "amount_moved": "$0.00",
                    "proposed_allocations": '{"euler_v2":"$1.00"}',
                    "executed_allocations": None,
                    "apr_improvement": None,
                    "gas_cost_usd": None,
                    "tx_hash": "0xabc",
                    "created_at": "2026-04-01T00:00:00Z",
                }
            ])
            self._table_calls = 0

        def table(self, name: str):
            assert name == "rebalance_logs"
            self._table_calls += 1
            return self._count_query if self._table_calls == 1 else self._rows_query

    db = _MissingMetadataDB()

    async def _fake_lookup_account(_db, _address, _auth):
        return {"id": "acct-metadata", "address": "0xabc"}

    monkeypatch.setattr(rebalance, "_lookup_account", _fake_lookup_account)

    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/api/v1/rebalance/0xabc/history",
        "headers": [],
    })

    result = await rebalance.get_rebalance_history(
        request=request,
        address="0xabc",
        db=db,
        _auth={"sub": "did:privy:test"},
        limit=10,
        offset=0,
        transactions_only=True,
    )

    assert result.total == 1
    assert len(result.logs) == 1
    assert result.logs[0].amount_moved == "1.000000"
    assert result.logs[0].from_protocol == "rebalance"
    assert result.logs[0].to_protocol == "euler_v2"


@pytest.mark.asyncio
async def test_get_rebalance_history_downgrades_reverted_executed_rows(monkeypatch) -> None:
    """Executed rows with reverted tx receipts must be surfaced as failed."""

    class _RevertedTxDB:
        def __init__(self):
            self._count_query = _FakeRebalanceLogsQuery(count=1)
            self._rows_query = _FakeRebalanceLogsQuery(rows=[
                {
                    "id": "00000000-0000-0000-0000-000000000020",
                    "status": "executed",
                    "skip_reason": None,
                    "from_protocol": None,
                    "to_protocol": None,
                    "amount_moved": None,
                    "proposed_allocations": '{"folks":"1.0"}',
                    "executed_allocations": None,
                    "apr_improvement": None,
                    "gas_cost_usd": None,
                    "tx_hash": "0xdeadbeef",
                    "created_at": "2026-04-01T00:00:00Z",
                }
            ])
            self._table_calls = 0

        def table(self, name: str):
            assert name == "rebalance_logs"
            self._table_calls += 1
            return self._count_query if self._table_calls == 1 else self._rows_query

    db = _RevertedTxDB()

    async def _fake_lookup_account(_db, _address, _auth):
        return {"id": "acct-reverted", "address": "0xabc"}

    monkeypatch.setattr(rebalance, "_lookup_account", _fake_lookup_account)
    monkeypatch.setattr(
        rebalance,
        "_tx_receipt_succeeded",
        AsyncMock(return_value=False),
    )

    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/api/v1/rebalance/0xabc/history",
        "headers": [],
    })

    result = await rebalance.get_rebalance_history(
        request=request,
        address="0xabc",
        db=db,
        _auth={"sub": "did:privy:test"},
        limit=10,
        offset=0,
        transactions_only=True,
    )

    assert result.total == 1
    assert len(result.logs) == 0


@pytest.mark.asyncio
async def test_get_rebalance_history_keeps_failed_executed_allocations_empty(monkeypatch) -> None:
    """Failed rows must not inherit proposed allocations as executed allocations."""

    class _FailedRowDB:
        def __init__(self):
            self._count_query = _FakeRebalanceLogsQuery(count=1)
            self._rows_query = _FakeRebalanceLogsQuery(rows=[
                {
                    "id": "00000000-0000-0000-0000-000000000021",
                    "status": "failed",
                    "skip_reason": "execution reverted",
                    "from_protocol": None,
                    "to_protocol": None,
                    "amount_moved": None,
                    "proposed_allocations": '{"folks":"1.0"}',
                    "executed_allocations": None,
                    "apr_improvement": None,
                    "gas_cost_usd": None,
                    "tx_hash": None,
                    "created_at": "2026-04-01T00:00:00Z",
                }
            ])
            self._table_calls = 0

        def table(self, name: str):
            assert name == "rebalance_logs"
            self._table_calls += 1
            return self._count_query if self._table_calls == 1 else self._rows_query

    db = _FailedRowDB()

    async def _fake_lookup_account(_db, _address, _auth):
        return {"id": "acct-failed", "address": "0xabc"}

    monkeypatch.setattr(rebalance, "_lookup_account", _fake_lookup_account)

    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/api/v1/rebalance/0xabc/history",
        "headers": [],
    })

    result = await rebalance.get_rebalance_history(
        request=request,
        address="0xabc",
        db=db,
        _auth={"sub": "did:privy:test"},
        limit=10,
        offset=0,
        transactions_only=False,
    )

    assert len(result.logs) == 1
    assert result.logs[0].status == "failed"
    assert result.logs[0].executed_allocations is None
