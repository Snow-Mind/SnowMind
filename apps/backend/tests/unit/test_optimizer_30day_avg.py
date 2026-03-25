from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from starlette.requests import Request

import pytest

from app.api.routes import optimizer as optimizer_routes


def _make_request() -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/optimizer/rates/30day-avg",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "query_string": b"",
        "scheme": "http",
    }
    return Request(scope)


class _FakeQuery:
    def __init__(self, data: list[dict]):
        self._data = data

    def select(self, _columns: str):
        return self

    def gte(self, _column: str, _value: str):
        return self

    def order(self, _column: str):
        return self

    def execute(self):
        return SimpleNamespace(data=self._data)


class _FakeDB:
    def __init__(self, snapshot_rows: list[dict]):
        self._snapshot_rows = snapshot_rows

    def table(self, name: str):
        assert name == "daily_apy_snapshots"
        return _FakeQuery(self._snapshot_rows)


class _FakeFetcher:
    def __init__(self, rates: dict[str, SimpleNamespace]):
        self._rates = rates

    async def fetch_all_rates(self):
        return self._rates


@pytest.mark.asyncio
async def test_30day_avg_uses_utilization_and_liquidity_adjustments(monkeypatch):
    snapshot_rows = [
        {"protocol_id": "aave_v3", "apy": "0.025", "tvl_usd": "100000000", "date": "2026-03-01"},
        {"protocol_id": "aave_v3", "apy": "0.030", "tvl_usd": "100000000", "date": "2026-03-02"},
        {"protocol_id": "spark", "apy": "0.040", "tvl_usd": "30000000", "date": "2026-03-01"},
        {"protocol_id": "spark", "apy": "0.035", "tvl_usd": "30000000", "date": "2026-03-02"},
    ]

    live_rates = {
        "aave_v3": SimpleNamespace(apy=Decimal("0.028"), utilization_rate=Decimal("0.70")),
        "spark": SimpleNamespace(apy=Decimal("0.038"), utilization_rate=Decimal("0.90")),
    }

    monkeypatch.setattr(
        optimizer_routes,
        "ALL_ADAPTERS",
        {
            "aave_v3": SimpleNamespace(name="Aave V3", is_active=True),
            "spark": SimpleNamespace(name="Spark Savings", is_active=True),
        },
    )
    monkeypatch.setattr(
        optimizer_routes,
        "ACTIVE_ADAPTERS",
        {
            "aave_v3": SimpleNamespace(name="Aave V3", is_active=True),
            "spark": SimpleNamespace(name="Spark Savings", is_active=True),
        },
    )
    monkeypatch.setattr(optimizer_routes, "_rate_fetcher", _FakeFetcher(live_rates))

    out = await optimizer_routes.get_30day_average_apy(_make_request(), _FakeDB(snapshot_rows))
    by_id = {item.protocol_id: item for item in out}

    assert by_id["aave_v3"].data_points == 2
    assert by_id["spark"].data_points == 2

    # Adjusted APY should be positive and reflect adjustment layers
    assert by_id["aave_v3"].adjusted_apy_30d > Decimal("0")
    assert by_id["spark"].adjusted_apy_30d > Decimal("0")

    # Spark has higher 30d average APY than Aave in this fixture
    assert by_id["spark"].avg_apy_30d > by_id["aave_v3"].avg_apy_30d


@pytest.mark.asyncio
async def test_30day_avg_falls_back_to_live_rate_when_no_snapshots(monkeypatch):
    live_rates = {
        "aave_v3": SimpleNamespace(apy=Decimal("0.027"), utilization_rate=Decimal("0.75")),
    }

    monkeypatch.setattr(
        optimizer_routes,
        "ALL_ADAPTERS",
        {"aave_v3": SimpleNamespace(name="Aave V3", is_active=True)},
    )
    monkeypatch.setattr(
        optimizer_routes,
        "ACTIVE_ADAPTERS",
        {"aave_v3": SimpleNamespace(name="Aave V3", is_active=True)},
    )
    monkeypatch.setattr(optimizer_routes, "_rate_fetcher", _FakeFetcher(live_rates))

    out = await optimizer_routes.get_30day_average_apy(_make_request(), _FakeDB([]))
    assert len(out) == 1
    assert out[0].protocol_id == "aave_v3"
    assert out[0].data_points == 0
    assert out[0].avg_apy_30d == Decimal("0.027")
