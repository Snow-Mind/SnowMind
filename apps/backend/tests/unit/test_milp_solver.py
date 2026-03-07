"""Unit tests for the MILP solver.

Tests cover:
  1. Equal APY → 50/50 split
  2. Unequal APY → favours higher but respects 60% cap
  3. $1000 total with $500 min → only 2 protocols can be active
  4. All unavailable → fallback returns safely
  5. Risk aversion = 1.0 → risky protocol penalised
  6. is_rebalance_worth_it: delta < 5% → False
  7. is_rebalance_worth_it: delta > 5% + yield improvement → True
"""

import pytest
from decimal import Decimal

from app.services.optimizer.milp_solver import (
    OptimizerInput,
    OptimizerOutput,
    ProtocolInput,
    compute_delta,
    compute_weighted_apy,
    fallback_equal_split,
    is_rebalance_worth_it,
    solve,
)

D = Decimal  # shorthand


# ── Helpers ──────────────────────────────────────────────────────────────────

def _print_result(label: str, r: OptimizerOutput) -> None:
    """Print solver output for manual inspection during dev."""
    print(f"\n=== {label} ===")
    print(f"  Status:       {r.status}")
    print(f"  Allocations:  {r.allocations}")
    print(f"  Expected APY: {r.expected_apy}")
    print(f"  Risk score:   {r.risk_score}")
    print(f"  Objective:    {r.objective_value}")
    print(f"  Solve time:   {r.solve_time_ms:.1f}ms")
    print(f"  Rebalance:    {r.is_rebalance_needed}")
    print(f"  Delta:        {r.delta_from_current}")


# ── Test 1: Equal APY → 50/50 ───────────────────────────────────────────────

def test_equal_apy_splits_both_active():
    """Two protocols, identical APY & risk → both must be active, any split valid."""
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=[
            ProtocolInput("proto_a", apy=D("0.05"), risk_score=D("3.0")),
            ProtocolInput("proto_b", apy=D("0.05"), risk_score=D("3.0")),
        ],
    )
    result = solve(inp)
    _print_result("Test 1 — Equal APY", result)

    assert result.status == "optimal"
    # Both protocols participate (min_protocols=2)
    assert "proto_a" in result.allocations
    assert "proto_b" in result.allocations
    # Total matches budget
    assert float(sum(result.allocations.values())) == pytest.approx(10_000.0, abs=1.0)
    # Neither exceeds 60% cap
    assert result.allocations["proto_a"] <= D("6001")
    assert result.allocations["proto_b"] <= D("6001")
    # Each meets min_allocation ($500)
    assert result.allocations["proto_a"] >= D("499")
    assert result.allocations["proto_b"] >= D("499")


# ── Test 2: Higher APY favoured but capped at 60% ───────────────────────────

def test_higher_apy_favoured_with_cap():
    """5% vs 2% APY — optimizer favours first but max 60% cap."""
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=[
            ProtocolInput("high_yield", apy=D("0.05"), risk_score=D("2.0")),
            ProtocolInput("low_yield", apy=D("0.02"), risk_score=D("2.0")),
        ],
    )
    result = solve(inp)
    _print_result("Test 2 — Higher APY with cap", result)

    assert result.status == "optimal"
    # high_yield should be at 60% cap = 6000
    assert float(result.allocations["high_yield"]) == pytest.approx(6000.0, abs=1.0)
    assert float(result.allocations["low_yield"]) == pytest.approx(4000.0, abs=1.0)
    assert result.expected_apy > D("0.02")


# ── Test 3: $1000 with $500 min → only 2 protocols ──────────────────────────

def test_min_allocation_limits_active_protocols():
    """$1000 total, $500 min per protocol → at most 2 active."""
    inp = OptimizerInput(
        total_amount_usd=D("1000"),
        protocols=[
            ProtocolInput("a", apy=D("0.06"), risk_score=D("2.0"), min_allocation=D("500")),
            ProtocolInput("b", apy=D("0.04"), risk_score=D("3.0"), min_allocation=D("500")),
            ProtocolInput("c", apy=D("0.03"), risk_score=D("4.0"), min_allocation=D("500")),
        ],
        min_protocols=2,
    )
    result = solve(inp)
    _print_result("Test 3 — $1000 with $500 min", result)

    assert result.status == "optimal"
    active_protos = [pid for pid, amt in result.allocations.items() if amt > D("1")]
    assert len(active_protos) == 2
    # Best two by risk-adjusted yield should be a and b
    assert "a" in active_protos
    assert "b" in active_protos


# ── Test 4: All unavailable → fallback ───────────────────────────────────────

def test_all_unavailable_returns_fallback():
    """All protocols unavailable → fallback returns safely."""
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=[
            ProtocolInput("a", apy=D("0.05"), risk_score=D("2.0"), is_available=False),
            ProtocolInput("b", apy=D("0.04"), risk_score=D("3.0"), is_available=False),
        ],
    )
    result = solve(inp)
    _print_result("Test 4 — All unavailable", result)

    assert result.status == "infeasible"
    assert result.allocations == {}


# ── Test 5: High risk aversion penalises risky protocol ─────────────────────

def test_risk_aversion_penalises_risky():
    """
    risk_aversion=1.0: risky protocol (risk=9) should get less allocation
    than safe protocol (risk=1) despite higher APY.
    """
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=[
            ProtocolInput("safe", apy=D("0.04"), risk_score=D("1.0")),
            ProtocolInput("risky", apy=D("0.06"), risk_score=D("9.0")),
        ],
        risk_aversion=D("1.0"),
    )
    result = solve(inp)
    _print_result("Test 5 — High risk aversion", result)

    assert result.status == "optimal"
    # Safe should get more despite lower APY because risk penalty dominates
    assert result.allocations["safe"] > result.allocations["risky"]


# ── Test 6: is_rebalance_worth_it — delta < 5% → False ──────────────────────

def test_rebalance_not_worth_it_small_delta():
    """Delta < 5% of total → no rebalance."""
    delta = {"a": D("200"), "b": D("-200")}  # 200/10000 = 2%
    worth, reason = is_rebalance_worth_it(
        delta=delta,
        total=D("10000"),
        gas_cost_usd=D("0.10"),
        proposed_apy=D("0.05"),
        current_apy=D("0.04"),
    )
    print(f"\nTest 6 — Small delta: worth={worth}, reason={reason}")
    assert worth is False
    assert "threshold" in reason.lower()


# ── Test 7: is_rebalance_worth_it — delta > 5% + yield ↑ → True ─────────────

def test_rebalance_worth_it_large_delta_and_yield():
    """Delta > 5% AND yield improvement positive → should rebalance."""
    delta = {"a": D("1000"), "b": D("-1000")}  # 1000/10000 = 10%
    worth, reason = is_rebalance_worth_it(
        delta=delta,
        total=D("10000"),
        gas_cost_usd=D("0.10"),
        proposed_apy=D("0.05"),
        current_apy=D("0.03"),
    )
    print(f"\nTest 7 — Large delta + yield: worth={worth}, reason={reason}")
    assert worth is True
    assert "approved" in reason.lower()


# ── Extra: compute helpers ───────────────────────────────────────────────────

def test_compute_delta():
    proposed = {"a": D("6000"), "b": D("4000")}
    current = {"a": D("5000"), "b": D("5000")}
    delta = compute_delta(proposed, current)
    assert delta["a"] == D("1000")
    assert delta["b"] == D("-1000")


def test_compute_weighted_apy():
    allocs = {"a": D("6000"), "b": D("4000")}
    rates = {"a": D("0.05"), "b": D("0.03")}
    apy = compute_weighted_apy(allocs, rates)
    # (6000*0.05 + 4000*0.03) / 10000 = (300+120)/10000 = 0.042
    assert float(apy) == pytest.approx(0.042, abs=0.0001)
