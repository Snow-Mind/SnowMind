from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.api.routes import optimizer as optimizer_routes
from app.services.protocols.base import ProtocolHealth, ProtocolStatus


def _make_request() -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/optimizer/rates/timeseries",
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


class _FakeAdapter:
    def __init__(self, protocol_id: str, deposit_safe: bool):
        self.protocol_id = protocol_id
        self.name = protocol_id
        self.is_active = True
        self._deposit_safe = deposit_safe

    async def get_health(self) -> ProtocolHealth:
        return ProtocolHealth(
            protocol_id=self.protocol_id,
            status=(
                ProtocolStatus.HEALTHY
                if self._deposit_safe
                else ProtocolStatus.HIGH_UTILIZATION
            ),
            is_deposit_safe=self._deposit_safe,
            is_withdrawal_safe=True,
            utilization=Decimal("0.95") if not self._deposit_safe else Decimal("0.60"),
            details={},
        )


@pytest.mark.asyncio
async def test_timeseries_excludes_non_deposit_safe_protocol_spikes(monkeypatch):
    optimizer_routes._timeseries_cache = None

    snapshot_rows = [
        {"protocol_id": "aave_v3", "apy": "0.023", "tvl_usd": "100000000", "date": "2026-04-04"},
        {"protocol_id": "benqi", "apy": "0.040", "tvl_usd": "100000000", "date": "2026-04-04"},
        {"protocol_id": "silo_savusd_usdc", "apy": "0.195", "tvl_usd": "4000000", "date": "2026-04-04"},
        {"protocol_id": "aave_v3", "apy": "0.024", "tvl_usd": "100000000", "date": "2026-04-05"},
        {"protocol_id": "benqi", "apy": "0.041", "tvl_usd": "100000000", "date": "2026-04-05"},
        {"protocol_id": "silo_savusd_usdc", "apy": "0.205", "tvl_usd": "3500000", "date": "2026-04-05"},
    ]

    monkeypatch.setattr(
        optimizer_routes,
        "ACTIVE_ADAPTERS",
        {
            "aave_v3": _FakeAdapter("aave_v3", deposit_safe=True),
            "benqi": _FakeAdapter("benqi", deposit_safe=True),
            "silo_savusd_usdc": _FakeAdapter("silo_savusd_usdc", deposit_safe=False),
        },
    )
    monkeypatch.setattr(
        optimizer_routes,
        "get_settings",
        lambda: SimpleNamespace(
            APY_TIMESERIES_CACHE_TTL_SECONDS=0,
            MAX_APY_SANITY_BOUND=0.25,
        ),
    )

    out = await optimizer_routes.get_apy_timeseries(_make_request(), _FakeDB(snapshot_rows))
    by_date = {item.date: item for item in out}

    assert by_date["2026-04-04"].snowmind_apy == Decimal("0.040")
    assert by_date["2026-04-04"].aave_apy == Decimal("0.023")
    assert by_date["2026-04-05"].snowmind_apy == Decimal("0.041")
    assert by_date["2026-04-05"].aave_apy == Decimal("0.024")


@pytest.mark.asyncio
async def test_timeseries_applies_conservative_liquidity_weight(monkeypatch):
    optimizer_routes._timeseries_cache = None

    snapshot_rows = [
        {"protocol_id": "aave_v3", "apy": "0.020", "tvl_usd": "100000000", "date": "2026-04-05"},
        {"protocol_id": "benqi", "apy": "0.050", "tvl_usd": "5000000", "date": "2026-04-05"},
    ]

    monkeypatch.setattr(
        optimizer_routes,
        "ACTIVE_ADAPTERS",
        {
            "aave_v3": _FakeAdapter("aave_v3", deposit_safe=True),
            "benqi": _FakeAdapter("benqi", deposit_safe=True),
        },
    )
    monkeypatch.setattr(
        optimizer_routes,
        "get_settings",
        lambda: SimpleNamespace(
            APY_TIMESERIES_CACHE_TTL_SECONDS=0,
            MAX_APY_SANITY_BOUND=0.25,
        ),
    )

    out = await optimizer_routes.get_apy_timeseries(_make_request(), _FakeDB(snapshot_rows))
    assert len(out) == 1

    # TVL=5M -> factor = 0.85 + (5/50)*0.15 = 0.865
    expected = Decimal("0.050") * Decimal("0.865")
    assert out[0].snowmind_apy == expected


@pytest.mark.asyncio
async def test_timeseries_returns_empty_when_no_deployable_protocols(monkeypatch):
    optimizer_routes._timeseries_cache = None

    snapshot_rows = [
        {"protocol_id": "aave_v3", "apy": "0.020", "tvl_usd": "100000000", "date": "2026-04-05"},
        {"protocol_id": "silo_savusd_usdc", "apy": "0.150", "tvl_usd": "5000000", "date": "2026-04-05"},
    ]

    monkeypatch.setattr(
        optimizer_routes,
        "ACTIVE_ADAPTERS",
        {
            "aave_v3": _FakeAdapter("aave_v3", deposit_safe=False),
            "silo_savusd_usdc": _FakeAdapter("silo_savusd_usdc", deposit_safe=False),
        },
    )
    monkeypatch.setattr(
        optimizer_routes,
        "get_settings",
        lambda: SimpleNamespace(
            APY_TIMESERIES_CACHE_TTL_SECONDS=0,
            MAX_APY_SANITY_BOUND=0.25,
        ),
    )

    out = await optimizer_routes.get_apy_timeseries(_make_request(), _FakeDB(snapshot_rows))
    assert out == []
