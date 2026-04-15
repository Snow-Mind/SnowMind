"""Unit tests for deprecated withdrawal endpoints in rebalance routes."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.routes import rebalance


class _FakeRebalanceLogsTable:
    def __init__(self):
        self.inserted_rows: list[dict] = []

    def insert(self, row: dict):
        self.inserted_rows.append(row)
        return self

    def execute(self):
        return SimpleNamespace(data=[])


class _FakeDB:
    def __init__(self):
        self.rebalance_logs = _FakeRebalanceLogsTable()

    def table(self, name: str):
        assert name == "rebalance_logs"
        return self.rebalance_logs


def _request() -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/api/v1/rebalance/0xabc/partial-withdraw",
        "headers": [],
    })


@pytest.mark.asyncio
async def test_partial_withdraw_endpoint_is_deprecated(monkeypatch) -> None:
    db = _FakeDB()

    async def _fake_lookup_account(_db, _address, _auth):
        return {"id": "acct-2", "address": "0xdef"}

    monkeypatch.setattr(rebalance, "_lookup_account", _fake_lookup_account)

    with pytest.raises(HTTPException) as exc_info:
        await rebalance.partial_withdraw(
            request=_request(),
            address="0xdef",
            body=rebalance.PartialWithdrawRequest(amount_usdc="12.5", protocol_id="benqi"),
            db=db,
            _auth={"sub": "did:privy:test"},
        )

    assert exc_info.value.status_code == 410
    assert "Legacy partial-withdraw endpoint is deprecated" in str(exc_info.value.detail)
    assert len(db.rebalance_logs.inserted_rows) == 0
