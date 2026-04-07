from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.api.routes import optimizer as optimizer_routes
from app.services.protocols.base import ProtocolRate


class _FakeQuery:
    def __init__(self, data: list[dict]):
        self._data = data

    def select(self, _columns: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def limit(self, _value: int):
        return self

    def execute(self):
        return SimpleNamespace(data=self._data)


class _FakeDB:
    def __init__(self, *, account_rows: list[dict], allocation_rows: list[dict]):
        self._account_rows = account_rows
        self._allocation_rows = allocation_rows

    def table(self, name: str):
        if name == "accounts":
            return _FakeQuery(self._account_rows)
        if name == "allocations":
            return _FakeQuery(self._allocation_rows)
        raise AssertionError(f"Unexpected table {name}")


class _FakeFetcher:
    def __init__(self, rates: dict[str, ProtocolRate]):
        self._rates = rates

    async def fetch_active_rates(self):
        return self._rates

    def validate_rate(self, _rate: ProtocolRate) -> bool:
        return True


def _post_request(path: str) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "query_string": b"",
        "scheme": "http",
    }
    return Request(scope)


def _rate(protocol_id: str, apy: str, tvl_usd: str, util: str) -> ProtocolRate:
    return ProtocolRate(
        protocol_id=protocol_id,
        apy=Decimal(apy),
        effective_apy=Decimal(apy),
        tvl_usd=Decimal(tvl_usd),
        utilization_rate=Decimal(util),
        fetched_at=1234.0,
    )


@pytest.mark.asyncio
async def test_simulate_prefers_higher_apy_even_when_edge_is_below_legacy_base_margin(monkeypatch) -> None:
    rates = {
        "spark": _rate("spark", "0.03000", "50000000", "0.00"),
        "benqi": _rate("benqi", "0.03005", "100000000", "0.50"),
    }

    monkeypatch.setattr(optimizer_routes, "_rate_fetcher", _FakeFetcher(rates))
    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "compute_risk_score",
        lambda *_args, **_kwargs: Decimal("5"),
    )
    monkeypatch.setattr(
        optimizer_routes,
        "ALL_ADAPTERS",
        {
            "spark": SimpleNamespace(name="Spark", is_active=True),
            "benqi": SimpleNamespace(name="Benqi", is_active=True),
        },
    )
    monkeypatch.setattr(
        optimizer_routes,
        "ACTIVE_ADAPTERS",
        {
            "spark": SimpleNamespace(name="Spark", is_active=True),
            "benqi": SimpleNamespace(name="Benqi", is_active=True),
        },
    )

    out = await optimizer_routes.simulate_optimization(
        _post_request("/api/v1/optimizer/simulate"),
        optimizer_routes.SimulateRequest(total_usdc=Decimal("10000")),
    )

    assert out.proposed_allocations
    by_protocol = {item.protocol_id: item for item in out.proposed_allocations}
    assert by_protocol["benqi"].proposed_amount_usd == Decimal("10000")
    assert "spark" not in by_protocol


@pytest.mark.asyncio
async def test_simulate_reports_idle_when_caps_bind_instead_of_parking_to_base_layer(monkeypatch) -> None:
    rates = {
        "benqi": _rate("benqi", "0.0400", "100", "0.50"),
    }

    monkeypatch.setattr(optimizer_routes, "_rate_fetcher", _FakeFetcher(rates))
    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "compute_risk_score",
        lambda *_args, **_kwargs: Decimal("5"),
    )
    monkeypatch.setattr(
        optimizer_routes,
        "ALL_ADAPTERS",
        {"benqi": SimpleNamespace(name="Benqi", is_active=True)},
    )
    monkeypatch.setattr(
        optimizer_routes,
        "ACTIVE_ADAPTERS",
        {"benqi": SimpleNamespace(name="Benqi", is_active=True)},
    )

    out = await optimizer_routes.simulate_optimization(
        _post_request("/api/v1/optimizer/simulate"),
        optimizer_routes.SimulateRequest(total_usdc=Decimal("100")),
    )

    by_protocol = {item.protocol_id: item for item in out.proposed_allocations}
    assert by_protocol["benqi"].proposed_amount_usd == Decimal("3.75")
    assert any("Hold idle" in line for line in out.reasoning)


@pytest.mark.asyncio
async def test_run_preview_uses_same_no_base_allocation_path_as_simulate(monkeypatch) -> None:
    rates = {
        "spark": _rate("spark", "0.03000", "50000000", "0.00"),
        "benqi": _rate("benqi", "0.03005", "100000000", "0.50"),
    }

    account_address = "0x0000000000000000000000000000000000000001"
    fake_db = _FakeDB(
        account_rows=[{"id": "acct-1", "owner_address": account_address, "privy_did": "did:privy:test"}],
        allocation_rows=[{"protocol_id": "spark", "amount_usdc": "10000"}],
    )

    monkeypatch.setattr(optimizer_routes, "_rate_fetcher", _FakeFetcher(rates))
    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "compute_risk_score",
        lambda *_args, **_kwargs: Decimal("5"),
    )
    monkeypatch.setattr(
        optimizer_routes,
        "verify_account_ownership",
        lambda *_args, **_kwargs: None,
    )

    out = await optimizer_routes.run_optimizer_preview(
        _post_request("/api/v1/optimizer/run"),
        optimizer_routes.RunOptimizerRequest(account_address=account_address),
        fake_db,
        _auth={"sub": "did:privy:test"},
    )

    by_protocol = {item.protocol_id: item for item in out.proposed_allocations}
    assert by_protocol["benqi"].proposed_amount_usd == Decimal("10000")
    assert "spark" not in by_protocol
    assert out.expected_apy > out.current_apy
