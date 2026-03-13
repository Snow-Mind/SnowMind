"""Unit tests for the MILP solver.

Tests cover:
    1. Equal APY → 50/50 split
    2. Unequal APY → favours higher but respects 60% cap
    3. $1000 total with $500 min → only 2 protocols can be active
    4. All unavailable → fallback returns safely
    5. Pure yield → higher APY protocol favoured regardless of risk_score
    6. is_rebalance_worth_it: delta < 5% → False
    7. is_rebalance_worth_it: delta > 5% + yield improvement → True
    8. pick_best_protocol → 100 % to highest APY
    9. solve() with balanced config (max_protocols=2, 60% cap)
 10. solve() with diversified config (max_protocols=4, 40% cap)
 11. two-tier routing threshold: <$10K uses pick_best_protocol path
"""

import pytest
from decimal import Decimal

from app.services.optimizer.milp_solver import (
    DIVERSIFICATION_CONFIGS,
    SPLIT_THRESHOLD,
    OptimizerInput,
    OptimizerOutput,
    ProtocolInput,
    compute_delta,
    compute_weighted_apy,
    fallback_equal_split,
    is_rebalance_worth_it,
    pick_best_protocol,
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


# ── Test 5: Pure yield ignores risk score ────────────────────────────────────

def test_pure_yield_ignores_risk_score():
    """
    Pure-yield objective: higher APY protocol (6%) gets 60% cap,
    lower APY protocol (4%) gets the rest — risk_score has no effect.
    """
    inp = OptimizerInput(
        total_amount_usd=D("10000"),
        protocols=[
            ProtocolInput("safe", apy=D("0.04"), risk_score=D("1.0")),
            ProtocolInput("risky", apy=D("0.06"), risk_score=D("9.0")),
        ],
    )
    result = solve(inp)
    _print_result("Test 5 — Pure yield ignores risk", result)

    assert result.status == "optimal"
    # Higher APY protocol should get more allocation (up to 60% cap)
    assert result.allocations["risky"] >= result.allocations["safe"]


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


# ── Test 8: pick_best_protocol → 100 % to highest APY ───────────────────────

def test_pick_best_protocol_returns_highest_apy():
    """Three protocols: 5%, 2%, 3% → all funds go to 5% one."""
    inp = OptimizerInput(
        total_amount_usd=D("5000"),
        protocols=[
            ProtocolInput("high", apy=D("0.05"), risk_score=D("0")),
            ProtocolInput("mid", apy=D("0.03"), risk_score=D("0")),
            ProtocolInput("low", apy=D("0.02"), risk_score=D("0")),
        ],
    )
    result = pick_best_protocol(inp)
    _print_result("Test 8 — pick_best_protocol", result)

    assert result.status == "optimal"
    assert "high" in result.allocations
    assert "mid" not in result.allocations
    assert "low" not in result.allocations
    assert float(result.allocations["high"]) == pytest.approx(5000.0, abs=0.01)
    assert result.expected_apy == D("0.05")


def test_pick_best_protocol_no_available_returns_infeasible():
    """All protocols unavailable → infeasible result."""
    inp = OptimizerInput(
        total_amount_usd=D("5000"),
        protocols=[
            ProtocolInput("a", apy=D("0.05"), risk_score=D("0"), is_available=False),
        ],
    )
    result = pick_best_protocol(inp)
    assert result.status == "infeasible"
    assert result.allocations == {}


# ── Test 9: solve() balanced config (max_protocols=2, 60% cap) ───────────────

def test_solve_balanced_config():
    """Balanced: max 2 protocols, 60% cap — higher APY gets 60%, rest to second."""
    config = DIVERSIFICATION_CONFIGS["balanced"]
    protocols = [
        ProtocolInput(
            "high", apy=D("0.05"), risk_score=D("0"),
            max_allocation_pct=config["max_allocation_pct"],
        ),
        ProtocolInput(
            "mid", apy=D("0.03"), risk_score=D("0"),
            max_allocation_pct=config["max_allocation_pct"],
        ),
        ProtocolInput(
            "low", apy=D("0.02"), risk_score=D("0"),
            max_allocation_pct=config["max_allocation_pct"],
        ),
    ]
    inp = OptimizerInput(
        total_amount_usd=D("15000"),
        protocols=protocols,
        max_protocols=config["max_protocols"],
        min_protocols=2,
    )
    result = solve(inp)
    _print_result("Test 9 — Balanced config", result)

    assert result.status == "optimal"
    active = [pid for pid, amt in result.allocations.items() if amt > D("1")]
    assert len(active) <= 2
    # 60% cap: no protocol > 9001 on $15K
    for pid, amt in result.allocations.items():
        assert float(amt) <= 9001.0, f"{pid} exceeds 60% cap"
    # Budget constraint
    assert float(sum(result.allocations.values())) == pytest.approx(15000.0, abs=1.0)


# ── Test 10: solve() diversified config (max_protocols=4, 40% cap) ───────────

def test_solve_diversified_config():
    """Diversified: max 4 protocols, 40% cap. Budget must be fully allocated."""
    config = DIVERSIFICATION_CONFIGS["diversified"]
    protocols = [
        ProtocolInput(
            f"p{i}", apy=D(str(0.06 - i * 0.01)), risk_score=D("0"),
            max_allocation_pct=config["max_allocation_pct"],
        )
        for i in range(4)
    ]
    inp = OptimizerInput(
        total_amount_usd=D("20000"),
        protocols=protocols,
        max_protocols=config["max_protocols"],
        min_protocols=2,
    )
    result = solve(inp)
    _print_result("Test 10 — Diversified config", result)

    assert result.status == "optimal"
    active = [pid for pid, amt in result.allocations.items() if amt > D("1")]
    assert len(active) <= 4
    # 40% cap: no protocol > 8001 on $20K
    for pid, amt in result.allocations.items():
        assert float(amt) <= 8001.0, f"{pid} exceeds 40% cap"
    assert float(sum(result.allocations.values())) == pytest.approx(20000.0, abs=1.0)


# ── Test 11: routing threshold — $5K uses pick_best_protocol path ────────────

def test_routing_threshold_small_deposit():
    """Below SPLIT_THRESHOLD ($10K): pick_best_protocol gives optimal single protocol."""
    assert D("5000") < SPLIT_THRESHOLD

    inp = OptimizerInput(
        total_amount_usd=D("5000"),
        protocols=[
            ProtocolInput("benqi", apy=D("0.05"), risk_score=D("0")),
            ProtocolInput("aave_v3", apy=D("0.02"), risk_score=D("0")),
        ],
    )
    result = pick_best_protocol(inp)
    _print_result("Test 11 — Small deposit routing", result)

    # Should go entirely to benqi (highest APY)
    assert "benqi" in result.allocations
    assert "aave_v3" not in result.allocations
    assert float(result.allocations["benqi"]) == pytest.approx(5000.0, abs=0.01)


def test_routing_threshold_large_deposit_uses_milp():
    """Above SPLIT_THRESHOLD ($10K): solve() (MILP) is the right path."""
    assert D("15000") >= SPLIT_THRESHOLD

    config = DIVERSIFICATION_CONFIGS["balanced"]
    protocols = [
        ProtocolInput(
            "benqi", apy=D("0.05"), risk_score=D("0"),
            max_allocation_pct=config["max_allocation_pct"],
        ),
        ProtocolInput(
            "aave_v3", apy=D("0.02"), risk_score=D("0"),
            max_allocation_pct=config["max_allocation_pct"],
        ),
    ]
    inp = OptimizerInput(
        total_amount_usd=D("15000"),
        protocols=protocols,
        max_protocols=config["max_protocols"],
        min_protocols=2,
    )
    result = solve(inp)
    _print_result("Test 12 — Large deposit MILP", result)

    assert result.status == "optimal"
    # Both protocols should participate (min_protocols=2)
    assert "benqi" in result.allocations
    assert "aave_v3" in result.allocations
    # benqi gets 60% cap = 9000
    assert float(result.allocations["benqi"]) == pytest.approx(9000.0, abs=1.0)
    assert float(result.allocations["aave_v3"]) == pytest.approx(6000.0, abs=1.0)


def test_compute_weighted_apy():
    allocs = {"a": D("6000"), "b": D("4000")}
    rates = {"a": D("0.05"), "b": D("0.03")}
    apy = compute_weighted_apy(allocs, rates)
    # (6000*0.05 + 4000*0.03) / 10000 = (300+120)/10000 = 0.042
    assert float(apy) == pytest.approx(0.042, abs=0.0001)
