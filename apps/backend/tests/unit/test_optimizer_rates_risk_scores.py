from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.api.routes import optimizer as optimizer_routes
from app.services.optimizer.risk_scorer import RiskBreakdown, RiskScoreResult
from app.services.protocols.base import ProtocolRate


def _make_request() -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/optimizer/rates",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "query_string": b"",
        "scheme": "http",
    }
    return Request(scope)


def _score(
    protocol_id: str,
    total: str,
    oracle: int,
    liquidity: int,
    collateral: int,
    yield_profile: int,
    architecture: int,
    *,
    snapshot_created_at: datetime | None = None,
) -> RiskScoreResult:
    effective_snapshot_created_at = snapshot_created_at or datetime.now(timezone.utc)
    return RiskScoreResult(
        protocol_id=protocol_id,
        score=Decimal(total),
        score_max=Decimal("9"),
        breakdown=RiskBreakdown(
            oracle=oracle,
            liquidity=liquidity,
            collateral=collateral,
            yield_profile=yield_profile,
            architecture=architecture,
        ),
        available_liquidity_usd=Decimal("1000000"),
        apy_mean=Decimal("0.03"),
        apy_stddev=Decimal("0.001"),
        sample_days=30,
        snapshot_created_at=effective_snapshot_created_at,
    )


class _FakeFetcher:
    def __init__(self, rates: dict[str, ProtocolRate]):
        self._rates = rates

    async def fetch_all_rates(self):
        return self._rates


@pytest.mark.asyncio
async def test_get_all_rates_uses_persisted_risk_breakdown(monkeypatch) -> None:
    rates = {
        "aave_v3": ProtocolRate(
            protocol_id="aave_v3",
            apy=Decimal("0.03"),
            effective_apy=Decimal("0.03"),
            tvl_usd=Decimal("100000000"),
            utilization_rate=Decimal("0.70"),
            fetched_at=1234.0,
        )
    }

    monkeypatch.setattr(optimizer_routes, "_rate_fetcher", _FakeFetcher(rates))
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
    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "get_latest_persisted_scores",
        lambda _db: {"aave_v3": _score("aave_v3", "7", 2, 2, 1, 1, 1)},
    )

    async def _never_called(_db, _rates):
        return {}

    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "compute_scores_from_rates",
        _never_called,
    )

    optimizer_routes._rates_cache = None
    out = await optimizer_routes.get_all_rates(_make_request(), SimpleNamespace())

    assert len(out) == 1
    assert out[0].risk_score == Decimal("7")
    assert out[0].risk_score_max == 9
    assert out[0].risk_breakdown is not None
    assert out[0].risk_breakdown.oracle == 2
    assert out[0].risk_breakdown.liquidity == 2


@pytest.mark.asyncio
async def test_get_all_rates_falls_back_to_computed_risk_when_not_persisted(monkeypatch) -> None:
    rates = {
        "aave_v3": ProtocolRate(
            protocol_id="aave_v3",
            apy=Decimal("0.03"),
            effective_apy=Decimal("0.03"),
            tvl_usd=Decimal("100000000"),
            utilization_rate=Decimal("0.70"),
            fetched_at=1234.0,
        )
    }

    monkeypatch.setattr(optimizer_routes, "_rate_fetcher", _FakeFetcher(rates))
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
    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "get_latest_persisted_scores",
        lambda _db: {},
    )

    async def _computed(_db, _rates):
        return {"aave_v3": _score("aave_v3", "6", 2, 1, 1, 1, 1)}

    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "compute_scores_from_rates",
        _computed,
    )

    optimizer_routes._rates_cache = None
    out = await optimizer_routes.get_all_rates(_make_request(), SimpleNamespace())

    assert len(out) == 1
    assert out[0].risk_score == Decimal("6")
    assert out[0].risk_breakdown is not None
    assert out[0].risk_breakdown.yield_profile == 1


@pytest.mark.asyncio
async def test_get_all_rates_recomputes_when_persisted_snapshot_is_stale(monkeypatch) -> None:
    rates = {
        "aave_v3": ProtocolRate(
            protocol_id="aave_v3",
            apy=Decimal("0.03"),
            effective_apy=Decimal("0.03"),
            tvl_usd=Decimal("100000000"),
            utilization_rate=Decimal("0.70"),
            fetched_at=1234.0,
        )
    }

    monkeypatch.setattr(optimizer_routes, "_rate_fetcher", _FakeFetcher(rates))
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

    stale_time = datetime.now(timezone.utc) - timedelta(days=3)
    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "get_latest_persisted_scores",
        lambda _db: {
            "aave_v3": _score(
                "aave_v3",
                "7",
                2,
                2,
                1,
                1,
                1,
                snapshot_created_at=stale_time,
            )
        },
    )

    async def _computed(_db, _rates):
        assert "aave_v3" in _rates
        return {
            "aave_v3": _score(
                "aave_v3",
                "5",
                2,
                0,
                1,
                1,
                1,
                snapshot_created_at=datetime.now(timezone.utc),
            )
        }

    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "compute_scores_from_rates",
        _computed,
    )

    optimizer_routes._rates_cache = None
    out = await optimizer_routes.get_all_rates(_make_request(), SimpleNamespace())

    assert len(out) == 1
    assert out[0].risk_score == Decimal("5")
    assert out[0].risk_breakdown is not None
    assert out[0].risk_breakdown.liquidity == 0
