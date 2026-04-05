from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.api.routes import optimizer as optimizer_routes
from app.services.optimizer.risk_report_explainer import RiskReportContext
from app.services.optimizer.risk_scorer import RiskBreakdown, RiskScoreResult
from app.services.protocols.base import ProtocolRate


def _make_request() -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/optimizer/risk/explanations/aave_v3",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "query_string": b"",
        "scheme": "http",
    }
    return Request(scope)


def _score(total: str) -> RiskScoreResult:
    return RiskScoreResult(
        protocol_id="aave_v3",
        score=Decimal(total),
        score_max=Decimal("9"),
        breakdown=RiskBreakdown(
            oracle=2,
            liquidity=2,
            collateral=1,
            yield_profile=1,
            architecture=1,
        ),
        available_liquidity_usd=Decimal("1000000"),
        apy_mean=Decimal("0.03"),
        apy_stddev=Decimal("0.001"),
        sample_days=30,
        snapshot_created_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_get_protocol_risk_explanation_uses_persisted_snapshot(monkeypatch) -> None:
    monkeypatch.setattr(
        optimizer_routes,
        "ALL_ADAPTERS",
        {"aave_v3": SimpleNamespace(name="Aave V3")},
    )
    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "get_latest_persisted_scores",
        lambda _db: {"aave_v3": _score("7")},
    )

    async def _unused_fetch():
        return {}

    monkeypatch.setattr(optimizer_routes._rate_fetcher, "fetch_all_rates", _unused_fetch)
    monkeypatch.setattr(
        optimizer_routes._risk_report_explainer,
        "get_context",
        lambda _pid: RiskReportContext(
            framework_markdown="## Scoring Framework (Max 9 Points)",
            protocol_markdown="### Aave V3 (Avalanche)",
            report_source="report.md",
            report_updated_at="2026-04-05T00:00:00+00:00",
        ),
    )

    out = await optimizer_routes.get_protocol_risk_explanation(
        "aave_v3",
        _make_request(),
        SimpleNamespace(),
    )

    assert out.protocol_id == "aave_v3"
    assert out.protocol_name == "Aave V3"
    assert out.risk_score == Decimal("7")
    assert out.risk_score_max == 9
    assert out.risk_breakdown is not None
    assert out.risk_breakdown.oracle == 2
    assert "Scoring Framework" in out.framework_context
    assert "Aave V3" in out.protocol_context


@pytest.mark.asyncio
async def test_get_protocol_risk_explanation_falls_back_without_snapshot(monkeypatch) -> None:
    monkeypatch.setattr(
        optimizer_routes,
        "ALL_ADAPTERS",
        {"aave_v3": SimpleNamespace(name="Aave V3")},
    )
    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "get_latest_persisted_scores",
        lambda _db: {},
    )

    async def _no_rates():
        return {}

    monkeypatch.setattr(optimizer_routes._rate_fetcher, "fetch_all_rates", _no_rates)
    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "compute_risk_score",
        lambda _protocol_id: Decimal("4"),
    )
    monkeypatch.setattr(
        optimizer_routes._risk_report_explainer,
        "get_context",
        lambda _pid: RiskReportContext(
            framework_markdown="framework",
            protocol_markdown="protocol",
            report_source="report.md",
            report_updated_at="2026-04-05T00:00:00+00:00",
        ),
    )

    out = await optimizer_routes.get_protocol_risk_explanation(
        "aave_v3",
        _make_request(),
        SimpleNamespace(),
    )

    assert out.risk_score == Decimal("4")
    assert out.risk_breakdown is None
    assert any("informational" in note.lower() for note in out.explanation_notes)


@pytest.mark.asyncio
async def test_get_protocol_risk_explanation_recomputes_stale_snapshot(monkeypatch) -> None:
    monkeypatch.setattr(
        optimizer_routes,
        "ALL_ADAPTERS",
        {"aave_v3": SimpleNamespace(name="Aave V3")},
    )

    stale_score = RiskScoreResult(
        protocol_id="aave_v3",
        score=Decimal("7"),
        score_max=Decimal("9"),
        breakdown=RiskBreakdown(
            oracle=2,
            liquidity=2,
            collateral=1,
            yield_profile=1,
            architecture=1,
        ),
        available_liquidity_usd=Decimal("1000000"),
        apy_mean=Decimal("0.03"),
        apy_stddev=Decimal("0.001"),
        sample_days=30,
        snapshot_created_at=datetime.now(timezone.utc) - timedelta(days=2),
    )
    monkeypatch.setattr(
        optimizer_routes._risk_scorer,
        "get_latest_persisted_scores",
        lambda _db: {"aave_v3": stale_score},
    )

    async def _fetch_rates():
        return {
            "aave_v3": ProtocolRate(
                protocol_id="aave_v3",
                apy=Decimal("0.031"),
                effective_apy=Decimal("0.031"),
                tvl_usd=Decimal("100000000"),
                utilization_rate=Decimal("0.70"),
                fetched_at=1234.0,
            )
        }

    async def _compute(_db, _rates):
        return {
            "aave_v3": RiskScoreResult(
                protocol_id="aave_v3",
                score=Decimal("5"),
                score_max=Decimal("9"),
                breakdown=RiskBreakdown(
                    oracle=2,
                    liquidity=0,
                    collateral=1,
                    yield_profile=1,
                    architecture=1,
                ),
                available_liquidity_usd=Decimal("450000"),
                apy_mean=Decimal("0.03"),
                apy_stddev=Decimal("0.001"),
                sample_days=30,
                snapshot_created_at=datetime.now(timezone.utc),
            )
        }

    monkeypatch.setattr(optimizer_routes._rate_fetcher, "fetch_all_rates", _fetch_rates)
    monkeypatch.setattr(optimizer_routes._risk_scorer, "compute_scores_from_rates", _compute)
    monkeypatch.setattr(
        optimizer_routes._risk_report_explainer,
        "get_context",
        lambda _pid: RiskReportContext(
            framework_markdown="framework",
            protocol_markdown="protocol",
            report_source="report.md",
            report_updated_at="2026-04-05T00:00:00+00:00",
        ),
    )

    out = await optimizer_routes.get_protocol_risk_explanation(
        "aave_v3",
        _make_request(),
        SimpleNamespace(),
    )

    assert out.risk_score == Decimal("5")
    assert out.risk_breakdown is not None
    assert out.risk_breakdown.liquidity == 0
