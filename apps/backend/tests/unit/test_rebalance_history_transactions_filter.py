"""Unit tests for rebalance history transaction-only filtering."""

from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.api.routes import rebalance


class _FakeRebalanceLogsQuery:
    def __init__(self, *, count: int | None = None, rows: list[dict] | None = None):
        self._count = count
        self._rows = rows or []
        self.neq_calls: list[tuple[str, str]] = []

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
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
    """transactionsOnly=true must exclude skipped logs at query layer."""
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
    assert ("status", "skipped") in db._count_query.neq_calls
    assert ("status", "skipped") in db._rows_query.neq_calls
