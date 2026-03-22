"""Shared optimizer types, utilities, and legacy MILP solver.

The LIVE allocation algorithm is a waterfall (APY-ranked greedy fill):
    - rebalancer.py  → compute_allocation() from allocator.py
    - /simulate       → waterfall_allocate() from waterfall_allocator.py

This module provides shared data classes (OptimizerInput, OptimizerOutput,
ProtocolInput) and helpers (compute_delta, compute_weighted_apy,
is_rebalance_worth_it, pick_best_protocol) used across the optimizer.

The solve() MILP function below is DEPRECATED / DEAD CODE — kept for
reference only. It is not called by any live code path.
"""

import logging
import time
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_DOWN

import pulp

logger = logging.getLogger("snowmind")

_ZERO = Decimal("0")
_ONE = Decimal("1")
_TEN = Decimal("10")
_365 = Decimal("365")

# ── Two-tier routing constants ────────────────────────────────────────────────

SPLIT_THRESHOLD = Decimal("10000")          # Below this, always single-protocol

DIVERSIFICATION_CONFIGS: dict[str, dict] = {
    # max_yield: 100 % in single best protocol (uses pick_best_protocol)
    "max_yield":   {"max_protocols": 1, "max_allocation_pct": Decimal("1.0")},
    # balanced: split across ≤ 2 protocols, 60 % cap each
    "balanced":    {"max_protocols": 2, "max_allocation_pct": Decimal("0.60")},
    # diversified: spread across ≤ 4 protocols, 40 % cap each
    "diversified": {"max_protocols": 4, "max_allocation_pct": Decimal("0.40")},
}


# ── USDC conversion helpers ──────────────────────────────────────────────────

def usdc_wei_to_decimal(wei: int) -> Decimal:
    """Convert USDC wei (6 decimals) to a Decimal dollar amount."""
    return Decimal(str(wei)) / Decimal("1000000")


def decimal_to_usdc_wei(amount: Decimal) -> int:
    """Convert a Decimal dollar amount to USDC wei (6 decimals), rounding down."""
    return int(amount.quantize(Decimal("0.000001"), rounding=ROUND_DOWN) * 1000000)


# ── Data classes ──────────────────────────────────────────────────────────────


@dataclass
class ProtocolInput:
    """Protocol data fed into the solver."""

    protocol_id: str
    apy: Decimal  # Annual yield as decimal (Decimal("0.041") = 4.1%)
    risk_score: Decimal  # 10 (safest) to 0 (riskiest)
    min_allocation: Decimal = Decimal("500")  # Minimum USD if participating
    max_allocation_pct: Decimal = Decimal("0.60")  # Max fraction of total
    is_available: bool = True


@dataclass
class OptimizerInput:
    """Everything the solver needs to produce an allocation."""

    total_amount_usd: Decimal
    protocols: list[ProtocolInput]
    current_allocations: dict[str, Decimal] = field(default_factory=dict)
    gas_cost_estimate_usd: Decimal = Decimal("0.008")
    risk_aversion: Decimal = Decimal("0.5")  # λ  (0 = pure yield, 1 = pure safety)
    min_protocols: int = 1  # Allow single protocol for small amounts
    max_protocols: int = 4


@dataclass
class OptimizerOutput:
    """Result of an allocation computation (waterfall or legacy MILP)."""

    allocations: dict[str, Decimal]  # protocol_id → USD amount
    expected_apy: Decimal  # Weighted average APY
    risk_score: Decimal  # Weighted average risk
    objective_value: Decimal  # Objective function value
    solve_time_ms: float  # timing — not financial, stays float
    status: str  # "optimal" | "feasible" | "infeasible"
    is_rebalance_needed: bool
    delta_from_current: dict[str, Decimal]


# ── Helpers ───────────────────────────────────────────────────────────────────

MIN_REBALANCE_THRESHOLD = Decimal("0.05")  # 5 %


def compute_delta(
    proposed: dict[str, Decimal],
    current: dict[str, Decimal],
) -> dict[str, Decimal]:
    """Per-protocol allocation change in USD."""
    all_pids = set(proposed) | set(current)
    return {
        pid: (proposed.get(pid, _ZERO) - current.get(pid, _ZERO)).quantize(Decimal("0.01"))
        for pid in all_pids
    }


def compute_weighted_apy(
    allocations: dict[str, Decimal],
    protocol_rates: dict[str, Decimal],
) -> Decimal:
    """Weighted average APY across allocations."""
    total = sum(allocations.values(), _ZERO)
    if total <= _ZERO:
        return _ZERO
    return sum(
        (amt / total) * protocol_rates.get(pid, _ZERO)
        for pid, amt in allocations.items()
    )


def is_rebalance_worth_it(
    delta: dict[str, Decimal],
    total: Decimal,
    gas_cost_usd: Decimal,
    proposed_apy: Decimal,
    current_apy: Decimal,
) -> tuple[bool, str]:
    """
    Two-condition gate:
      1. Max |delta_i| / total > MIN_REBALANCE_THRESHOLD (5 %)
      2. Annualised yield improvement in USD > gas_cost × 365
         (Bypassed for initial deployments where current_apy is 0)
    Returns (should_rebalance, reason).
    """
    if total <= _ZERO:
        return False, "Total deposit is zero"

    max_pct = max((abs(d) / total for d in delta.values()), default=_ZERO)
    if max_pct <= MIN_REBALANCE_THRESHOLD:
        return False, (
            f"Max delta {float(max_pct):.2%} <= threshold {float(MIN_REBALANCE_THRESHOLD):.0%}"
        )

    # For initial deployments (no existing yield), always approve
    if current_apy <= _ZERO:
        return True, "Initial deployment — no existing yield, deploying to protocols"

    # Per-day gas comparison: daily yield improvement must exceed single rebalance gas
    daily_yield_improvement = (proposed_apy - current_apy) * total / _365
    if daily_yield_improvement <= gas_cost_usd:
        return False, (
            f"Daily yield +${float(daily_yield_improvement):.4f} "
            f"<= rebalance gas ${float(gas_cost_usd):.4f}"
        )

    return True, (
        f"Rebalance approved: delta {float(max_pct):.2%}, "
        f"daily yield +${float(daily_yield_improvement):.4f}"
    )


# ── Fallback ──────────────────────────────────────────────────────────────────


# ── Simple-mode solver ────────────────────────────────────────────────────────


def pick_best_protocol(inp: OptimizerInput) -> OptimizerOutput:
    """Simple mode: allocate 100 % to the protocol with the highest APY.

    Used when total_amount_usd < SPLIT_THRESHOLD or when the user's
    diversification_preference is 'max_yield'.
    """
    available = [p for p in inp.protocols if p.is_available]
    if not available:
        return OptimizerOutput(
            allocations={},
            expected_apy=_ZERO,
            risk_score=_ZERO,
            objective_value=_ZERO,
            solve_time_ms=0.0,
            status="infeasible",
            is_rebalance_needed=False,
            delta_from_current={},
        )

    best = max(available, key=lambda p: p.apy)
    allocations = {best.protocol_id: inp.total_amount_usd}
    rates = {p.protocol_id: p.apy for p in available}

    delta = compute_delta(allocations, inp.current_allocations)
    current_apy = compute_weighted_apy(inp.current_allocations, rates)
    worth, reason = is_rebalance_worth_it(
        delta,
        inp.total_amount_usd,
        inp.gas_cost_estimate_usd,
        best.apy,
        current_apy,
    )
    logger.info(
        "pick_best_protocol → %s (APY %.2f%%): %s",
        best.protocol_id, float(best.apy) * 100, reason,
    )

    return OptimizerOutput(
        allocations=allocations,
        expected_apy=best.apy,
        risk_score=best.risk_score,
        objective_value=best.apy * inp.total_amount_usd,
        solve_time_ms=0.0,
        status="optimal",
        is_rebalance_needed=worth,
        delta_from_current=delta,
    )


# ── Fallback (allocation failure) ──────────────────────────────────────────────


def fallback_equal_split(inp: OptimizerInput) -> OptimizerOutput:
    """Fallback: equally split between best 2 protocols by APY."""
    available = sorted(
        (p for p in inp.protocols if p.is_available),
        key=lambda p: p.apy,
        reverse=True,
    )
    pick = available[: max(inp.min_protocols, 1)] if available else []

    if not pick:
        return OptimizerOutput(
            allocations={},
            expected_apy=_ZERO,
            risk_score=_ZERO,
            objective_value=_ZERO,
            solve_time_ms=0.0,
            status="infeasible",
            is_rebalance_needed=False,
            delta_from_current={},
        )

    n = Decimal(str(len(pick)))
    share = (inp.total_amount_usd / n).quantize(Decimal("0.01"))
    allocs: dict[str, Decimal] = {p.protocol_id: share for p in pick}
    rates: dict[str, Decimal] = {p.protocol_id: p.apy for p in pick}
    total = sum(allocs.values(), _ZERO) or _ONE

    delta = compute_delta(allocs, inp.current_allocations)
    worth, _ = is_rebalance_worth_it(
        delta,
        inp.total_amount_usd,
        inp.gas_cost_estimate_usd,
        compute_weighted_apy(allocs, rates),
        compute_weighted_apy(
            inp.current_allocations,
            {p.protocol_id: p.apy for p in inp.protocols},
        ),
    )

    return OptimizerOutput(
        allocations=allocs,
        expected_apy=compute_weighted_apy(allocs, rates),
        risk_score=sum(
            (allocs[p.protocol_id] / total) * p.risk_score for p in pick
        ),
        objective_value=_ZERO,
        solve_time_ms=0.0,
        status="infeasible",
        is_rebalance_needed=worth,
        delta_from_current=delta,
    )


# ── Legacy MILP solver (DEPRECATED — not used in live code paths) ────────────


def solve(inp: OptimizerInput) -> OptimizerOutput:
    """
    MAXIMIZE  Σ(x_i × apy_i)

    Constraints:
      1. Budget:        Σ x_i = total_amount_usd
      2. Max alloc %:   x_i ≤ max_allocation_pct × total × y_i
      3. Min alloc:     x_i ≥ min_allocation × y_i
      4. Min protocols: Σ y_i ≥ min_protocols
      5. Max protocols: Σ y_i ≤ max_protocols
      6. Big-M linkage: x_i ≤ M × y_i

    All Decimal fields are converted to float for PuLP, then results
    are converted back to Decimal for storage/output.
    """
    protocols = [p for p in inp.protocols if p.is_available]
    if len(protocols) < inp.min_protocols:
        logger.warning(
            "Only %d available protocols (need %d) — fallback",
            len(protocols),
            inp.min_protocols,
        )
        return fallback_equal_split(inp)

    # Convert Decimal → float at PuLP boundary
    f_total = float(inp.total_amount_usd)

    prob = pulp.LpProblem("SnowMind_Yield_Optimizer", pulp.LpMaximize)

    # Decision variables
    x = {
        p.protocol_id: pulp.LpVariable(f"x_{p.protocol_id}", lowBound=0)
        for p in protocols
    }
    y = {
        p.protocol_id: pulp.LpVariable(f"y_{p.protocol_id}", cat="Binary")
        for p in protocols
    }

    # Objective: pure yield — diversification enforced by constraint C5 (max_protocols)
    prob += pulp.lpSum([x[p.protocol_id] * float(p.apy) for p in protocols])

    # C1 — Budget
    prob += pulp.lpSum([x[p.protocol_id] for p in protocols]) == f_total

    M = f_total  # Big-M constant

    for p in protocols:
        pid = p.protocol_id
        # C2 — Max allocation %
        prob += x[pid] <= float(p.max_allocation_pct) * f_total * y[pid]
        # C3 — Min allocation (if active)
        prob += x[pid] >= float(p.min_allocation) * y[pid]
        # C6 — Big-M linkage
        prob += x[pid] <= M * y[pid]

    # C4 — Min protocols
    prob += pulp.lpSum([y[p.protocol_id] for p in protocols]) >= inp.min_protocols
    # C5 — Max protocols
    prob += pulp.lpSum([y[p.protocol_id] for p in protocols]) <= inp.max_protocols

    # Solve
    t0 = time.time()
    prob.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=30))
    solve_ms = (time.time() - t0) * 1000

    if prob.status != pulp.constants.LpStatusOptimal:
        logger.warning("Legacy MILP status=%d — falling back to equal split", prob.status)
        result = fallback_equal_split(inp)
        result.solve_time_ms = solve_ms
        result.status = "feasible" if prob.status == 0 else "infeasible"
        return result

    # Extract results — convert float back to Decimal, filter dust < $1
    allocations: dict[str, Decimal] = {}
    for p in protocols:
        val = pulp.value(x[p.protocol_id])
        if val is not None and val > 1.0:
            allocations[p.protocol_id] = Decimal(str(round(val, 2)))

    total_alloc = sum(allocations.values(), _ZERO) or _ONE
    rates: dict[str, Decimal] = {p.protocol_id: p.apy for p in protocols}

    weighted_apy = compute_weighted_apy(allocations, rates)
    weighted_risk = sum(
        (allocations.get(p.protocol_id, _ZERO) / total_alloc) * p.risk_score
        for p in protocols
        if p.protocol_id in allocations
    )

    delta = compute_delta(allocations, inp.current_allocations)
    current_apy = compute_weighted_apy(inp.current_allocations, rates)
    worth, reason = is_rebalance_worth_it(
        delta,
        inp.total_amount_usd,
        inp.gas_cost_estimate_usd,
        weighted_apy,
        current_apy,
    )
    logger.info("Legacy MILP solved in %.1fms: %s", solve_ms, reason)

    obj_val = pulp.value(prob.objective)
    return OptimizerOutput(
        allocations=allocations,
        expected_apy=weighted_apy,
        risk_score=weighted_risk,
        objective_value=Decimal(str(round(obj_val, 6))) if obj_val else _ZERO,
        solve_time_ms=solve_ms,
        status="optimal",
        is_rebalance_needed=worth,
        delta_from_current=delta,
    )
