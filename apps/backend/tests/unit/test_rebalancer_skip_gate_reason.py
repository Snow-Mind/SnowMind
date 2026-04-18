"""Unit tests for standardized skip-gate reason formatting."""

from app.services.optimizer.rebalancer import _format_skip_gate_reason


def test_skip_gate_reason_includes_gate_observed_and_threshold() -> None:
    reason = _format_skip_gate_reason(
        "APY improvement below beat margin",
        gate="beat_margin",
        observed="0.0400%",
        threshold="0.2500%",
    )

    assert "APY improvement below beat margin" in reason
    assert "gate=beat_margin" in reason
    assert "observed=0.0400%" in reason
    assert "threshold=0.2500%" in reason


def test_skip_gate_reason_appends_skipped_market_suffix() -> None:
    reason = _format_skip_gate_reason(
        "Total movement below $0.01",
        gate="movement_floor",
        observed="$0.0007",
        threshold="$0.0100",
        skipped_markets_suffix=" Skipped markets: Euler (Liquidity stress: utilization 93.2% > 90.0%).",
    )

    assert reason.endswith("Skipped markets: Euler (Liquidity stress: utilization 93.2% > 90.0%).")
