from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services.optimizer.risk_scorer import RiskScorer
from app.services.protocols.base import ProtocolRate


def test_compute_liquidity_score_thresholds() -> None:
    scorer = RiskScorer()

    assert scorer.compute_liquidity_score(Decimal("11000000")) == 3
    assert scorer.compute_liquidity_score(Decimal("2000000")) == 2
    assert scorer.compute_liquidity_score(Decimal("700000")) == 1
    assert scorer.compute_liquidity_score(Decimal("100000")) == 0

    # Boundary behavior follows strict ">" thresholds.
    assert scorer.compute_liquidity_score(Decimal("10000000")) == 2
    assert scorer.compute_liquidity_score(Decimal("1000000")) == 1
    assert scorer.compute_liquidity_score(Decimal("500000")) == 0


def test_compute_yield_profile_score_stability_rules() -> None:
    scorer = RiskScorer()

    # Not enough data points yet.
    score, mean, stddev, sample_days = scorer.compute_yield_profile_score(
        [Decimal("0.03")] * 6
    )
    assert score == 0
    assert mean is None
    assert stddev is None
    assert sample_days == 6

    # Stable APY distribution -> 1 point.
    stable = [
        Decimal("0.030"),
        Decimal("0.031"),
        Decimal("0.029"),
        Decimal("0.0305"),
        Decimal("0.0295"),
        Decimal("0.0302"),
        Decimal("0.0298"),
    ]
    score, mean, stddev, sample_days = scorer.compute_yield_profile_score(stable)
    assert score == 1
    assert mean is not None
    assert stddev is not None
    assert sample_days == len(stable)

    # Volatile APY distribution -> 0 points.
    volatile = [
        Decimal("0.01"),
        Decimal("0.08"),
        Decimal("0.02"),
        Decimal("0.09"),
        Decimal("0.015"),
        Decimal("0.10"),
        Decimal("0.03"),
    ]
    score, _, _, _ = scorer.compute_yield_profile_score(volatile)
    assert score == 0


def test_derive_available_liquidity_lending_and_spark() -> None:
    scorer = RiskScorer()

    lending_rate = ProtocolRate(
        protocol_id="benqi",
        apy=Decimal("0.03"),
        effective_apy=Decimal("0.03"),
        tvl_usd=Decimal("100"),
        utilization_rate=Decimal("0.75"),
        fetched_at=0.0,
    )
    assert scorer.derive_available_liquidity("benqi", lending_rate) == Decimal("25.00")

    spark_rate = ProtocolRate(
        protocol_id="spark",
        apy=Decimal("0.03"),
        effective_apy=Decimal("0.03"),
        tvl_usd=Decimal("100"),
        utilization_rate=None,
        fetched_at=0.0,
    )
    assert scorer.derive_available_liquidity(
        "spark",
        spark_rate,
        spark_psm_liquidity_usd=Decimal("50"),
    ) == Decimal("60.00")


@pytest.mark.asyncio
async def test_compute_scores_from_rates_combines_static_and_dynamic(monkeypatch) -> None:
    scorer = RiskScorer()

    rates = {
        "benqi": ProtocolRate(
            protocol_id="benqi",
            apy=Decimal("0.04"),
            effective_apy=Decimal("0.04"),
            tvl_usd=Decimal("12000000"),
            utilization_rate=Decimal("0.50"),
            fetched_at=0.0,
        ),
        "euler_v2": ProtocolRate(
            protocol_id="euler_v2",
            apy=Decimal("0.09"),
            effective_apy=Decimal("0.09"),
            tvl_usd=Decimal("2000000"),
            utilization_rate=Decimal("0.90"),
            fetched_at=0.0,
        ),
    }

    monkeypatch.setattr(
        scorer,
        "get_recent_apy_samples",
        lambda _db, _protocol_ids: {
            "benqi": [
                Decimal("0.030"),
                Decimal("0.031"),
                Decimal("0.029"),
                Decimal("0.0305"),
                Decimal("0.0295"),
                Decimal("0.0302"),
                Decimal("0.0298"),
            ],
            "euler_v2": [
                Decimal("0.01"),
                Decimal("0.08"),
                Decimal("0.02"),
                Decimal("0.09"),
                Decimal("0.015"),
                Decimal("0.10"),
                Decimal("0.03"),
            ],
        },
    )

    scores = await scorer.compute_scores_from_rates(SimpleNamespace(), rates)

    # Benqi: static(5) + liquidity(2 for 6M available) + yield(1 stable) = 8.
    assert scores["benqi"].score == Decimal("8")
    assert scores["benqi"].breakdown.liquidity == 2
    assert scores["benqi"].breakdown.yield_profile == 1

    # Euler: static(2) + liquidity(0 for ~200k available) + yield(0 volatile) = 2.
    assert scores["euler_v2"].score == Decimal("2")
    assert scores["euler_v2"].breakdown.liquidity == 0
    assert scores["euler_v2"].breakdown.yield_profile == 0
