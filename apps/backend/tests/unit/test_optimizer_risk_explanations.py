from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.api.routes import optimizer as optimizer_routes
from app.services.optimizer.risk_report_explainer import RiskReportContext
from app.services.optimizer.risk_scorer import RiskBreakdown, RiskScoreResult


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
