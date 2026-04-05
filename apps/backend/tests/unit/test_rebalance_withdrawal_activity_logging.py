"""Unit tests for withdrawal activity logging in rebalance routes."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

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
        "path": "/api/v1/rebalance/0xabc/withdraw-all",
        "headers": [],
    })


@pytest.mark.asyncio
async def test_withdraw_all_logs_withdrawal_activity(monkeypatch) -> None:
    db = _FakeDB()

    async def _fake_lookup_account(_db, _address, _auth):
        return {"id": "acct-1", "address": "0xabc"}

    monkeypatch.setattr(rebalance, "_lookup_account", _fake_lookup_account)

    with patch("app.services.optimizer.rebalancer.Rebalancer") as rebalancer_cls:
        rebalancer_instance = rebalancer_cls.return_value
        rebalancer_instance.execute_emergency_withdrawal = AsyncMock(
            return_value=(
                "0xtxhash",
                {
                    "fee_usd": "0.500000",
                    "net_withdrawal_usd": "100.000000",
                    "fee_pct": "0.10",
                    "profit_usd": "5.000000",
                },
            )
        )

        result = await rebalance.withdraw_all(
            request=_request(),
            address="0xabc",
            db=db,
            _auth={"sub": "did:privy:test"},
        )

    assert result["status"] == "executed"
    assert len(db.rebalance_logs.inserted_rows) == 1
    inserted = db.rebalance_logs.inserted_rows[0]
    assert inserted["from_protocol"] == "withdrawal"
    assert inserted["to_protocol"] == "user_eoa"
    assert inserted["amount_moved"] == "100.500000"
    assert inserted["tx_hash"] == "0xtxhash"


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
