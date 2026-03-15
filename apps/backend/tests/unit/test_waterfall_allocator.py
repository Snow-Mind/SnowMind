"""Unit tests for the waterfall allocator.

Tests cover:
    1. Small deposit ($2K) → 100% to best protocol (TVL cap >> deposit)
    2. Large deposit ($50K, 40% exposure) → splits across top 2-3 protocols
    3. TVL cap limits allocation (small TVL pool)
    4. No protocol beats Spark → 100% to Spark
    5. Spark barely beaten (above margin) → allocates to protocol
    6. Spark not beaten enough (below margin) → 100% to Spark
    7. Per-day gas gate: daily improvement > gas → approve
    8. Per-day gas gate: daily improvement < gas → reject
    9. Empty protocol list → 100% to Spark (infeasible if no Spark)
   10. OptimizerOutput backward compatibility
"""

import pytest
from decimal import Decimal

from app.services.optimizer.milp_solver import (
    OptimizerInput,
    OptimizerOutput,
    ProtocolInput,
    is_rebalance_worth_it,
)
from app.services.optimizer.waterfall_allocator import waterfall_allocate

D = Decimal  # shorthand


def _print_result(label: str, r: OptimizerOutput) -> None:
    print(f"\n=== {label} ===")
    print(f"  Status:       {r.status}")
    print(f"  Allocations:  {r.allocations}")
    print(f"  Expected APY: {r.expected_apy}")
    print(f"  Risk score:   {r.risk_score}")
    print(f"  Rebalance:    {r.is_rebalance_needed}")
    print(f"  Delta:        {r.delta_from_current}")


# ── Shared fixtures ──────────────────────────────────────────────────────────

def _make_protocols(apys: dict[str, str], risk: str = "3.0") -> list[ProtocolInput]:
    return [
        ProtocolInput(pid, apy=D(apy), risk_score=D(risk))
        for pid, apy in apys.items()
    ]


def _make_tvl(tvls: dict[str, str]) -> dict[str, Decimal]:
    return {pid: D(tvl) for pid, tvl in tvls.items()}


# ── Test 1: Small deposit → 100% to best protocol ───────────────────────────

def test_small_deposit_goes_to_best_protocol():
    """$2K deposit — TVL caps far exceed deposit, so 100% to highest APY."""
    protocols = _make_protocols({
        "aave_v3": "0.05",
        "benqi": "0.04",
        "spark": "0.0375",
    })
    tvl = _make_tvl({
        "aave_v3": "100000000",
        "benqi": "80000000",
        "spark": "136000000",
    })
    inp = OptimizerInput(
        total_amount_usd=D("2000"),
        protocols=protocols,
    )
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl,
        tvl_cap_pct=D("0.15"),
        max_exposure_pct=D("1.00"),  # max_yield mode
        spark_beat_margin=D("0.005"),
    )
    _print_result("Test 1 — Small deposit", result)

    assert result.status == "optimal"
    # aave_v3 at 5% beats Spark (3.75%) by 1.25% > 0.5% margin
    assert "aave_v3" in result.allocations
    assert float(result.allocations["aave_v3"]) == pytest.approx(2000.0, abs=1.0)
    # Spark should not receive funds (aave gets everything)
    assert result.allocations.get("spark", D("0")) < D("2")


# ── Test 2: Large deposit splits across protocols ────────────────────────────

def test_large_deposit_splits_with_exposure_cap():
    """$50K deposit, 40% max exposure → $20K per protocol cap, splits across top 2-3."""
    protocols = _make_protocols({
        "aave_v3": "0.05",
        "benqi": "0.045",
        "euler_v2": "0.04",
        "spark": "0.0375",
    })
    tvl = _make_tvl({
        "aave_v3": "100000000",
        "benqi": "80000000",
        "euler_v2": "50000000",
        "spark": "136000000",
    })
    inp = OptimizerInput(
        total_amount_usd=D("50000"),
        protocols=protocols,
    )
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl,
        tvl_cap_pct=D("0.15"),
        max_exposure_pct=D("0.40"),  # 40% = $20K cap per protocol
        spark_beat_margin=D("0.005"),
    )
    _print_result("Test 2 — Large deposit split", result)

    assert result.status == "optimal"
    # aave_v3 and benqi both beat Spark by > 50bps
    assert "aave_v3" in result.allocations
    assert "benqi" in result.allocations
    # Each capped at 40% = $20K
    assert float(result.allocations["aave_v3"]) == pytest.approx(20000.0, abs=1.0)
    assert float(result.allocations["benqi"]) == pytest.approx(20000.0, abs=1.0)
    # Remainder goes to Spark (or euler if it beats margin)
    total_alloc = sum(float(v) for v in result.allocations.values())
    assert total_alloc == pytest.approx(50000.0, abs=5.0)


# ── Test 3: TVL cap limits allocation ────────────────────────────────────────

def test_tvl_cap_limits_allocation():
    """Protocol with small TVL ($100K): 15% cap = $15K max. Deposit $20K."""
    protocols = _make_protocols({
        "small_pool": "0.06",
        "spark": "0.0375",
    })
    tvl = _make_tvl({
        "small_pool": "100000",  # 15% = $15K cap
        "spark": "136000000",
    })
    inp = OptimizerInput(
        total_amount_usd=D("20000"),
        protocols=protocols,
    )
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl,
        tvl_cap_pct=D("0.15"),
        max_exposure_pct=D("1.00"),
        spark_beat_margin=D("0.005"),
    )
    _print_result("Test 3 — TVL cap", result)

    assert result.status == "optimal"
    # small_pool capped at 15% of $100K = $15K
    assert float(result.allocations["small_pool"]) == pytest.approx(15000.0, abs=1.0)
    # Remainder ($5K) goes to Spark
    assert float(result.allocations["spark"]) == pytest.approx(5000.0, abs=1.0)


# ── Test 4: No protocol beats Spark → 100% to Spark ─────────────────────────

def test_no_protocol_beats_spark():
    """All protocols below Spark APY → 100% to Spark."""
    protocols = _make_protocols({
        "aave_v3": "0.035",
        "benqi": "0.030",
        "spark": "0.0375",
    })
    tvl = _make_tvl({
        "aave_v3": "100000000",
        "benqi": "80000000",
        "spark": "136000000",
    })
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=protocols,
    )
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl,
        spark_beat_margin=D("0.005"),
    )
    _print_result("Test 4 — No protocol beats Spark", result)

    assert result.status == "optimal"
    assert "spark" in result.allocations
    assert float(result.allocations["spark"]) == pytest.approx(10000.0, abs=1.0)
    assert result.allocations.get("aave_v3", D("0")) < D("2")
    assert result.allocations.get("benqi", D("0")) < D("2")


# ── Test 5: Spark barely beaten (above margin) ──────────────────────────────

def test_spark_barely_beaten_above_margin():
    """Protocol at 4.30%, Spark at 3.75%, margin 0.50%. Diff = 0.55% > margin → allocate."""
    protocols = _make_protocols({
        "aave_v3": "0.0430",
        "spark": "0.0375",
    })
    tvl = _make_tvl({
        "aave_v3": "100000000",
        "spark": "136000000",
    })
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=protocols,
    )
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl,
        max_exposure_pct=D("1.00"),
        spark_beat_margin=D("0.005"),
    )
    _print_result("Test 5 — Spark barely beaten", result)

    assert "aave_v3" in result.allocations
    assert float(result.allocations["aave_v3"]) == pytest.approx(10000.0, abs=1.0)


# ── Test 6: Spark not beaten enough (below margin) ──────────────────────────

def test_spark_not_beaten_below_margin():
    """Protocol at 4.0%, Spark at 3.75%, margin 0.50%. Diff = 0.25% < margin → Spark."""
    protocols = _make_protocols({
        "aave_v3": "0.040",
        "spark": "0.0375",
    })
    tvl = _make_tvl({
        "aave_v3": "100000000",
        "spark": "136000000",
    })
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=protocols,
    )
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl,
        spark_beat_margin=D("0.005"),
    )
    _print_result("Test 6 — Spark not beaten enough", result)

    assert result.status == "optimal"
    assert "spark" in result.allocations
    assert float(result.allocations["spark"]) == pytest.approx(10000.0, abs=1.0)
    assert result.allocations.get("aave_v3", D("0")) < D("2")


# ── Test 7: Per-day gas gate — approve ───────────────────────────────────────

def test_perday_gas_gate_approves():
    """$10K, proposed 5% APY, current 4.5%. Daily improvement = $1.37 > gas $0.008."""
    delta = {"aave_v3": D("10000"), "spark": D("-10000")}
    worth, reason = is_rebalance_worth_it(
        delta=delta,
        total=D("10000"),
        gas_cost_usd=D("0.008"),
        proposed_apy=D("0.05"),
        current_apy=D("0.045"),
    )
    print(f"\nTest 7 — Per-day gate approve: worth={worth}, reason={reason}")
    assert worth is True
    assert "approved" in reason.lower()


# ── Test 8: Per-day gas gate — reject ────────────────────────────────────────

def test_perday_gas_gate_rejects_marginal():
    """$1K, proposed 4.1% APY, current 4.0%. Daily improvement = $0.0027 < gas $0.008."""
    delta = {"aave_v3": D("1000"), "spark": D("-1000")}
    worth, reason = is_rebalance_worth_it(
        delta=delta,
        total=D("1000"),
        gas_cost_usd=D("0.008"),
        proposed_apy=D("0.041"),
        current_apy=D("0.040"),
    )
    print(f"\nTest 8 — Per-day gate reject: worth={worth}, reason={reason}")
    assert worth is False
    assert "daily yield" in reason.lower()


# ── Test 9: No protocols available → infeasible ─────────────────────────────

def test_no_protocols_returns_infeasible():
    """All protocols unavailable → infeasible."""
    protocols = [
        ProtocolInput("aave_v3", apy=D("0.05"), risk_score=D("3"), is_available=False),
        ProtocolInput("spark", apy=D("0.0375"), risk_score=D("3"), is_available=False),
    ]
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=protocols,
    )
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol={"aave_v3": D("100000000"), "spark": D("136000000")},
    )
    _print_result("Test 9 — No protocols", result)

    assert result.status == "infeasible"
    assert result.allocations == {}
    assert result.is_rebalance_needed is False


# ── Test 10: OptimizerOutput backward compatibility ──────────────────────────

def test_output_has_all_required_fields():
    """waterfall_allocate returns a valid OptimizerOutput with all fields."""
    protocols = _make_protocols({
        "aave_v3": "0.05",
        "spark": "0.0375",
    })
    tvl = _make_tvl({"aave_v3": "100000000", "spark": "136000000"})
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=protocols,
    )
    result = waterfall_allocate(inp=inp, tvl_by_protocol=tvl)

    assert isinstance(result, OptimizerOutput)
    assert hasattr(result, "allocations")
    assert hasattr(result, "expected_apy")
    assert hasattr(result, "risk_score")
    assert hasattr(result, "objective_value")
    assert hasattr(result, "solve_time_ms")
    assert hasattr(result, "status")
    assert hasattr(result, "is_rebalance_needed")
    assert hasattr(result, "delta_from_current")
    assert result.expected_apy >= D("0")
    assert result.solve_time_ms >= 0
    assert result.status in ("optimal", "infeasible")


# ── Test 11: Spark-only (no other protocols) → 100% Spark ────────────────────

def test_spark_only_gets_100_pct():
    """Only Spark available → 100% to Spark."""
    protocols = _make_protocols({"spark": "0.0375"})
    tvl = _make_tvl({"spark": "136000000"})
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=protocols,
    )
    result = waterfall_allocate(inp=inp, tvl_by_protocol=tvl)
    _print_result("Test 11 — Spark only", result)

    assert result.status == "optimal"
    assert "spark" in result.allocations
    assert float(result.allocations["spark"]) == pytest.approx(10000.0, abs=1.0)


# ── Test 12: Multiple protocols beat Spark, exposure cap causes waterfall ────

def test_waterfall_cascading_fill():
    """3 protocols beat Spark, 30% exposure cap → cascading fill to all 3 + Spark."""
    protocols = _make_protocols({
        "aave_v3": "0.06",
        "benqi": "0.055",
        "euler_v2": "0.05",
        "spark": "0.0375",
    })
    tvl = _make_tvl({
        "aave_v3": "100000000",
        "benqi": "80000000",
        "euler_v2": "50000000",
        "spark": "136000000",
    })
    inp = OptimizerInput(
        total_amount_usd=D("100000"),
        protocols=protocols,
    )
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl,
        max_exposure_pct=D("0.30"),  # 30% = $30K per protocol
        spark_beat_margin=D("0.005"),
    )
    _print_result("Test 12 — Cascading waterfall", result)

    assert result.status == "optimal"
    # All 3 protocols beat Spark, each gets $30K cap
    assert float(result.allocations.get("aave_v3", 0)) == pytest.approx(30000.0, abs=1.0)
    assert float(result.allocations.get("benqi", 0)) == pytest.approx(30000.0, abs=1.0)
    assert float(result.allocations.get("euler_v2", 0)) == pytest.approx(30000.0, abs=1.0)
    # Remaining $10K to Spark
    assert float(result.allocations.get("spark", 0)) == pytest.approx(10000.0, abs=1.0)
    # Total = $100K
    total = sum(float(v) for v in result.allocations.values())
    assert total == pytest.approx(100000.0, abs=5.0)
